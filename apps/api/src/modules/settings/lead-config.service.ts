import { Injectable } from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { DbService } from '../../core/database/db.service';
import { ProblemException, Problems } from '../../core/errors/problem';
import { isStillReferenced, pgCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { versionConflict } from '../../core/http/etag';
import { Page, toPage } from '../../core/http/pagination';
import {
  LeadSourceDto,
  LeadSourceInputDto,
  LeadStageDto,
  LeadStageInputDto,
  ReasonDto,
  ReasonInputDto,
  ReasonListQuery,
} from './dto/settings.dto';
import { LeadConfigRepository, reasonCursor, sourceCursor, stageCursor } from './repositories/lead-config.repository';
import { LeadSourceRow, LeadStageRow, ReasonRow } from './settings.schema';

const STAGE_FIELDS = ['key', 'name', 'category', 'sortOrder', 'isActive'] as const;
const REASON_FIELDS = ['type', 'name', 'isActive'] as const;
const SOURCE_FIELDS = ['type', 'name', 'integrationId', 'qualityScore', 'isActive'] as const;

const builtIn = (detail: string) => new ProblemException(403, 'FORBIDDEN', 'Built-in item', detail);
const taken = (what: string) => new ProblemException(409, 'CONFLICT', `${what} already exists`, `A ${what.toLowerCase()} with this name or key already exists.`);
const inUse = (what: string) =>
  new ProblemException(409, 'CONFLICT', `${what} in use`, `This ${what.toLowerCase()} is used by existing records. Make it inactive instead.`);

/**
 * Lead stages, reasons and lead sources (SRS §2.19 editable stages, §2.21 reasons, §11.5).
 * Built-in stages and reasons are used by automation (10-minute rule, Lost/Invalid), so they cannot be deleted
 * and their key or category cannot change; they can be renamed, reordered or turned off.
 */
@Injectable()
export class LeadConfigService {
  constructor(
    private readonly repo: LeadConfigRepository,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  // ---------------------------------------------------------------- stages
  async listStages(limit: number, cursor?: string): Promise<Page<LeadStageDto>> {
    return toPage(await this.repo.listStages(limit, cursor), limit, stageCursor, LeadStageDto.from);
  }

  async getStage(id: string): Promise<LeadStageRow> {
    const stage = await this.repo.findStage(id);
    if (!stage) throw Problems.notFound();
    return stage;
  }

  /** For other modules: a stage by its stable key (e.g. new, follow_up, lost). */
  async stageByKey(key: string): Promise<LeadStageRow | undefined> {
    return this.repo.findStageByKey(key);
  }

  async createStage(body: LeadStageInputDto): Promise<LeadStageRow> {
    const missing = (['key', 'name', 'category', 'sortOrder'] as const).filter((f) => body[f] === undefined);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const stage = await this.repo
      .createStage({ key: body.key!, name: body.name!, category: body.category!, sortOrder: body.sortOrder!, isActive: body.isActive ?? true }, this.tenantId())
      .catch(rethrow('Stage'));
    await this.audit.record('create', 'lead_stages', stage.id, created(pick(stage, STAGE_FIELDS)));
    return stage;
  }

  async updateStage(id: string, body: LeadStageInputDto, expectedVersion?: string): Promise<LeadStageRow> {
    const before = await this.getStage(id);
    if (before.isSystem && ((body.key !== undefined && body.key !== before.key) || (body.category !== undefined && body.category !== before.category))) {
      throw builtIn('The key and category of a built-in stage cannot change.');
    }
    const values = pick(body, STAGE_FIELDS);
    if (!Object.keys(values).length) return before;
    const after = await this.repo.updateStage(id, values, expectedVersion).catch(rethrow('Stage'));
    if (!after) throw versionConflict();
    await this.audit.recordUpdate('lead_stages', id, pick(before, STAGE_FIELDS), pick(after, STAGE_FIELDS));
    return after;
  }

  async deleteStage(id: string): Promise<void> {
    const stage = await this.getStage(id);
    if (stage.isSystem) throw builtIn('Built-in stages cannot be deleted. Make the stage inactive instead.');
    await this.repo.deleteStage(id).catch(rethrow('Stage'));
    await this.audit.record('delete', 'lead_stages', id, { key: [stage.key, null] });
  }

  // ---------------------------------------------------------------- reasons
  async listReasons(query: ReasonListQuery): Promise<Page<ReasonDto>> {
    return toPage(await this.repo.listReasons(query.limit, query.cursor, query.type), query.limit, reasonCursor, ReasonDto.from);
  }

  async getReason(id: string): Promise<ReasonRow> {
    const reason = await this.repo.findReason(id);
    if (!reason) throw Problems.notFound();
    return reason;
  }

  /** For other modules: a built-in reason by key (e.g. reassignment/no_response). */
  async reasonByKey(type: ReasonRow['type'], key: string): Promise<ReasonRow | undefined> {
    return this.repo.findReasonByKey(type, key);
  }

  async createReason(body: ReasonInputDto): Promise<ReasonRow> {
    const missing = (['type', 'name'] as const).filter((f) => body[f] === undefined);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    if (body.key) throw Problems.validation([{ field: 'key', message: 'keys are reserved for built-in reasons' }]);
    const reason = await this.repo.createReason({ type: body.type!, name: body.name!, isActive: body.isActive ?? true }, this.tenantId()).catch(rethrow('Reason'));
    await this.audit.record('create', 'reasons', reason.id, created(pick(reason, REASON_FIELDS)));
    return reason;
  }

  async updateReason(id: string, body: ReasonInputDto): Promise<ReasonRow> {
    const before = await this.getReason(id);
    if (body.key !== undefined && body.key !== before.key) throw Problems.validation([{ field: 'key', message: 'the key cannot change' }]);
    if (before.key && body.type !== undefined && body.type !== before.type) throw builtIn('The type of a built-in reason cannot change.');
    const values = pick(body, REASON_FIELDS);
    if (!Object.keys(values).length) return before;
    const after = await this.repo.updateReason(id, values).catch(rethrow('Reason'));
    if (!after) throw Problems.notFound();
    await this.audit.recordUpdate('reasons', id, pick(before, REASON_FIELDS), pick(after, REASON_FIELDS));
    return after;
  }

  async deleteReason(id: string): Promise<void> {
    const reason = await this.getReason(id);
    if (reason.key) throw builtIn('Built-in reasons cannot be deleted. Make the reason inactive instead.');
    await this.repo.deleteReason(id).catch(rethrow('Reason'));
    await this.audit.record('delete', 'reasons', id, { name: [reason.name, null] });
  }

  // ---------------------------------------------------------------- sources
  async listSources(limit: number, cursor?: string): Promise<Page<LeadSourceDto>> {
    return toPage(await this.repo.listSources(limit, cursor), limit, sourceCursor, LeadSourceDto.from);
  }

  async getSource(id: string): Promise<LeadSourceRow> {
    const source = await this.repo.findSource(id);
    if (!source) throw Problems.notFound();
    return source;
  }

  /** For other modules: the active source of a type (e.g. manual, import). */
  async sourceByType(type: LeadSourceRow['type']): Promise<LeadSourceRow | undefined> {
    return this.repo.findSourceByType(type);
  }

  async createSource(body: LeadSourceInputDto): Promise<LeadSourceRow> {
    const missing = (['type', 'name'] as const).filter((f) => body[f] === undefined);
    if (missing.length) throw Problems.validation(missing.map((field) => ({ field, message: `${field} is required` })));
    const source = await this.repo
      .createSource({ ...pick(body, SOURCE_FIELDS), type: body.type!, name: body.name! }, this.tenantId())
      .catch(rethrow('Source'));
    await this.audit.record('create', 'lead_sources', source.id, created(pick(source, SOURCE_FIELDS)));
    return source;
  }

  async updateSource(id: string, body: LeadSourceInputDto): Promise<LeadSourceRow> {
    const before = await this.getSource(id);
    const values = pick(body, SOURCE_FIELDS);
    if (!Object.keys(values).length) return before;
    const after = await this.repo.updateSource(id, values).catch(rethrow('Source'));
    if (!after) throw Problems.notFound();
    await this.audit.recordUpdate('lead_sources', id, pick(before, SOURCE_FIELDS), pick(after, SOURCE_FIELDS));
    return after;
  }

  async deleteSource(id: string): Promise<void> {
    const source = await this.getSource(id);
    await this.repo.deleteSource(id).catch(rethrow('Source'));
    await this.audit.record('delete', 'lead_sources', id, { name: [source.name, null] });
  }

  private tenantId(): string {
    return this.db.currentTenantId!;
  }
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]])) as Partial<Pick<T, K>>;
}

function created(values: object): Record<string, [null, unknown]> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [null, v]]));
}

function rethrow(what: string) {
  return (err: unknown): never => {
    if (pgCode(err) === PG_UNIQUE_VIOLATION) throw taken(what);
    if (isStillReferenced(err)) throw inUse(what);
    if (pgCode(err) === PG_FOREIGN_KEY_VIOLATION) throw Problems.validation([{ field: 'integrationId', message: 'the linked record does not exist' }]);
    throw err;
  };
}
