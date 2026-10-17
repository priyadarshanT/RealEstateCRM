import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { asc, eq } from 'drizzle-orm';
import { boolean, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { AuditService } from '../../core/audit/audit.service';
import { RequirePermission } from '../../core/auth/decorators';
import { DbService } from '../../core/database/db.service';
import { isStillReferenced, pgCode, PG_UNIQUE_VIOLATION } from '../../core/errors/pg';
import { ProblemException, Problems } from '../../core/errors/problem';

// project_custom_fields (migration 0010): Project page › Manage Columns › Add Custom Field (Admin only).

export const FIELD_TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const projectCustomFields = pgTable('project_custom_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  fieldType: text('field_type').$type<FieldType>().notNull(),
  isRequired: boolean('is_required').notNull().default(false),
  options: text('options').array().notNull().default([]),
  sortOrder: smallint('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
type FieldRow = typeof projectCustomFields.$inferSelect;

export class CustomFieldDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Key in Project.customValues and the column key cf:<key>' }) key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: FIELD_TYPES }) fieldType!: FieldType;
  @ApiProperty() isRequired!: boolean;
  @ApiProperty({ type: [String] }) options!: string[];
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;

  static from(r: FieldRow): CustomFieldDto {
    return { id: r.id, key: r.key, label: r.label, fieldType: r.fieldType, isRequired: r.isRequired, options: r.options, sortOrder: r.sortOrder, isActive: r.isActive };
  }
}

export class CustomFieldList {
  @ApiProperty({ type: [CustomFieldDto] }) data!: CustomFieldDto[];
}

export class CustomFieldInputDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) label?: string;
  @ApiPropertyOptional({ enum: FIELD_TYPES }) @IsOptional() @IsIn(FIELD_TYPES) fieldType?: FieldType;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsString({ each: true }) @MaxLength(80, { each: true }) options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Optional on create; made from the label when empty' }) @IsOptional() @Matches(/^[a-z][a-z0-9_]{0,40}$/) key?: string;
}

/** Custom project fields: everyone reads them; only settings.manage (Admin) adds or changes them. */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<FieldRow[]> {
    return this.db.current.select().from(projectCustomFields).orderBy(asc(projectCustomFields.sortOrder), asc(projectCustomFields.label));
  }

  async create(body: CustomFieldInputDto): Promise<FieldRow> {
    if (!body.label?.trim() || !body.fieldType) throw Problems.validation([...(body.label?.trim() ? [] : [{ field: 'label', message: 'required' }]), ...(body.fieldType ? [] : [{ field: 'fieldType', message: 'required' }])]);
    const options = (body.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (body.fieldType === 'dropdown' && !options.length) throw Problems.validation([{ field: 'options', message: 'a dropdown needs at least one choice' }]);
    const key = body.key ?? toKey(body.label);
    const [row] = await this.db.current
      .insert(projectCustomFields)
      .values({ tenantId: this.db.currentTenantId!, key, label: body.label.trim(), fieldType: body.fieldType, isRequired: body.isRequired ?? false, options: body.fieldType === 'dropdown' ? options : [], sortOrder: body.sortOrder ?? 0, isActive: body.isActive ?? true })
      .returning()
      .catch(taken);
    await this.audit.record('create', 'project_custom_fields', row!.id, { key: [null, key], label: [null, row!.label], fieldType: [null, row!.fieldType] });
    return row!;
  }

  /** The type and key of a field cannot change (stored values would no longer fit); rename, choices, required, order and active can. */
  async update(id: string, body: CustomFieldInputDto): Promise<FieldRow> {
    const before = await this.get(id);
    if (body.fieldType !== undefined && body.fieldType !== before.fieldType) throw Problems.validation([{ field: 'fieldType', message: 'the type of a field cannot change' }]);
    if (body.key !== undefined && body.key !== before.key) throw Problems.validation([{ field: 'key', message: 'the key cannot change' }]);
    const options = body.options?.map((o) => o.trim()).filter(Boolean);
    if (before.fieldType === 'dropdown' && options && !options.length) throw Problems.validation([{ field: 'options', message: 'a dropdown needs at least one choice' }]);
    const [after] = await this.db.current
      .update(projectCustomFields)
      .set({
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.isRequired !== undefined ? { isRequired: body.isRequired } : {}),
        ...(options && before.fieldType === 'dropdown' ? { options } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      })
      .where(eq(projectCustomFields.id, id))
      .returning();
    await this.audit.recordUpdate('project_custom_fields', id, view(before), view(after!));
    return after!;
  }

  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    await this.db.current.delete(projectCustomFields).where(eq(projectCustomFields.id, id)).catch(taken);
    await this.audit.record('delete', 'project_custom_fields', id, { key: [row.key, null] });
  }

  /**
   * Checks the custom values of a project: known active fields only, the right type, a listed dropdown choice;
   * required fields must be filled (on create, and never cleared on update).
   */
  async check(values: Record<string, unknown>, before: Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const fields = (await this.list()).filter((f) => f.isActive);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const merged = { ...(before ?? {}), ...values };
    const errors: { field: string; message: string }[] = [];
    const out: Record<string, unknown> = { ...(before ?? {}) };
    for (const [key, value] of Object.entries(values)) {
      const f = byKey.get(key);
      if (!f) {
        errors.push({ field: `customValues.${key}`, message: 'unknown field' });
        continue;
      }
      if (value === null || value === '') {
        delete out[key];
        continue;
      }
      const ok =
        f.fieldType === 'text' ? typeof value === 'string' && value.length <= 1000
        : f.fieldType === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : f.fieldType === 'date' ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        : f.fieldType === 'checkbox' ? typeof value === 'boolean'
        : typeof value === 'string' && f.options.includes(value);
      if (!ok) errors.push({ field: `customValues.${key}`, message: f.fieldType === 'dropdown' ? `choose one of: ${f.options.join(', ')}` : `must be a ${f.fieldType}` });
      else out[key] = value;
    }
    for (const f of fields) {
      if (f.isRequired && (merged[f.key] === undefined || merged[f.key] === null || merged[f.key] === '')) errors.push({ field: `customValues.${f.key}`, message: `${f.label} is required` });
    }
    if (errors.length) throw Problems.validation(errors);
    return out;
  }

  private async get(id: string): Promise<FieldRow> {
    const [row] = await this.db.current.select().from(projectCustomFields).where(eq(projectCustomFields.id, id)).limit(1);
    if (!row) throw Problems.notFound();
    return row;
  }
}

function toKey(label: string): string {
  const k = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(k) ? k : `f_${k}`.slice(0, 40);
}

function view(r: FieldRow) {
  return { label: r.label, isRequired: r.isRequired, options: r.options, sortOrder: r.sortOrder, isActive: r.isActive };
}

function taken(err: unknown): never {
  if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ProblemException(409, 'CONFLICT', 'Already exists', 'A custom field with this key already exists.');
  if (isStillReferenced(err)) throw new ProblemException(409, 'CONFLICT', 'In use', 'This field is in use; turn it off instead.');
  throw err;
}

@ApiTags('Projects')
@ApiBearerAuth('bearer')
@Controller('project-custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @RequirePermission('leads.view')
  @ApiOperation({ operationId: 'listProjectCustomFields', summary: 'Custom project fields' })
  @ApiOkResponse({ type: CustomFieldList })
  async list(): Promise<CustomFieldList> {
    return { data: (await this.fields.list()).map(CustomFieldDto.from) };
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'createProjectCustomField', summary: 'Add a custom project field (Admin)' })
  @ApiCreatedResponse({ type: CustomFieldDto })
  async create(@Body() body: CustomFieldInputDto): Promise<CustomFieldDto> {
    return CustomFieldDto.from(await this.fields.create(body));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'updateProjectCustomField', summary: 'Change a custom project field (Admin)' })
  @ApiOkResponse({ type: CustomFieldDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: CustomFieldInputDto): Promise<CustomFieldDto> {
    return CustomFieldDto.from(await this.fields.update(id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  @ApiOperation({ operationId: 'deleteProjectCustomField', summary: 'Delete a custom project field (Admin)' })
  @ApiNoContentResponse({ description: 'Done' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.fields.remove(id);
  }
}
