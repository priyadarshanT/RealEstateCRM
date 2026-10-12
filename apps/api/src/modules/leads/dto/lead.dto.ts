import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsUuid } from '../../../core/http/validators';
import { LeadAccess } from '../lead-scope';
import { ACTIVITY_TYPES, ActivityRow, InquiryRow, LeadRow, SAVED_FILTER_ENTITIES, SavedFilterRow } from '../leads.schema';

const E164 = /^\+[1-9][0-9]{6,14}$/;
const MONEY = /^-?\d+(\.\d{1,2})?$/;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const CATEGORIES = ['open', 'won', 'lost', 'invalid'] as const;
const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/** Money as a string with 2 decimals (API guide §2). */
export const money = (v: string | null): string | undefined => (v === null ? undefined : Number(v).toFixed(2));

// ---------------------------------------------------------------- Lead (components.schemas.Lead)
export class LeadDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() fullName!: string;
  @ApiPropertyOptional({ pattern: E164.source }) phonePrimary?: string;
  @ApiPropertyOptional({ pattern: E164.source }) phoneAlternate?: string;
  @ApiPropertyOptional({ format: 'email' }) email?: string;
  @ApiPropertyOptional() countryCode?: string;
  @ApiPropertyOptional() preferredLanguage?: string;
  @ApiPropertyOptional() budgetMin?: string;
  @ApiPropertyOptional() budgetMax?: string;
  @ApiPropertyOptional() budgetCurrency?: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) campaignId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) eventId?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) priority!: LeadRow['priority'];
  @ApiPropertyOptional({ type: [String] }) projectIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) primaryProjectId?: string;
  @ApiPropertyOptional(nullableUuid) ownerUserId!: string | null;
  @ApiPropertyOptional(nullableUuid) teamId!: string | null;
  @ApiProperty({ format: 'uuid' }) stageId!: string;
  @ApiProperty({ enum: CATEGORIES }) stageCategory!: LeadRow['stageCategory'];
  @ApiPropertyOptional(nullableUuid) closeReasonId!: string | null;
  @ApiProperty({ minimum: 0, maximum: 100 }) score!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) latestNote!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) nextFollowUpAt!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) responseDueAt!: string | null;
  @ApiProperty() enquiryCount!: number;
  @ApiPropertyOptional({ format: 'date-time' }) lastEnquiryAt!: string;
  @ApiPropertyOptional({ enum: ['owner', 'edit', 'view', 'scope'], readOnly: true }) access?: LeadAccess;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) deletedAt!: string | null;
  @ApiProperty({ format: 'date-time', readOnly: true }) createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time', readOnly: true }) updatedAt!: string;
  @ApiProperty() version!: number;

  static from(l: LeadRow, projects: { projectIds: string[]; primaryProjectId?: string } | undefined, access?: LeadAccess): LeadDto {
    const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
    return {
      id: l.id,
      fullName: l.fullName,
      phonePrimary: opt(l.phonePrimary),
      phoneAlternate: opt(l.phoneAlternate),
      email: opt(l.email),
      countryCode: opt(l.countryCode),
      preferredLanguage: opt(l.preferredLanguage),
      budgetMin: money(l.budgetMin),
      budgetMax: money(l.budgetMax),
      budgetCurrency: opt(l.budgetCurrency),
      sourceId: l.sourceId,
      campaignId: opt(l.campaignId),
      eventId: opt(l.eventId),
      priority: l.priority,
      projectIds: projects?.projectIds ?? [],
      primaryProjectId: projects?.primaryProjectId,
      ownerUserId: l.ownerUserId,
      teamId: l.teamId,
      stageId: l.stageId,
      stageCategory: l.stageCategory,
      closeReasonId: l.closeReasonId,
      score: l.score,
      latestNote: l.latestNote,
      nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
      responseDueAt: l.responseDueAt?.toISOString() ?? null,
      enquiryCount: l.enquiryCount,
      lastEnquiryAt: l.lastEnquiryAt.toISOString(),
      access,
      deletedAt: l.deletedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
      version: l.version,
    };
  }
}

export class LeadPage {
  @ApiProperty({ type: [LeadDto] }) data!: LeadDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo & { total?: number };
}

export const LEAD_TABS = ['all', 'my', 'shared', 'team', 'unassigned', 'deleted', 'new', 'pending', 'scheduled', 'overdue', 'cold'] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

export class LeadListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: LEAD_TABS }) @IsOptional() @IsIn(LEAD_TABS) tab?: LeadTab;
  @ApiPropertyOptional({ description: 'Name, phone or email' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() stageId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() ownerUserId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() teamId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() sourceId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() campaignId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() eventId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) budgetMin?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) budgetMax?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) createdFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({ strict: true }) createdTo?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() savedFilterId?: string;
  @ApiPropertyOptional({ description: 'Default: -score,nextFollowUpAt' }) @IsOptional() @IsString() @MaxLength(200) sort?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() total?: boolean;
}

// ---------------------------------------------------------------- create / update
class LeadFields {
  @ApiPropertyOptional({ pattern: E164.source }) @IsOptional() @Matches(E164, { message: 'phonePrimary must be in E.164 format' }) phonePrimary?: string;
  @ApiPropertyOptional({ pattern: E164.source }) @IsOptional() @Matches(E164, { message: 'phoneAlternate must be in E.164 format' }) phoneAlternate?: string;
  @ApiPropertyOptional({ format: 'email' }) @IsOptional() @Transform(lowerTrim) @IsEmail() email?: string;
  @ApiPropertyOptional({ pattern: '^[A-Z]{2}$' }) @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z]{2}$/, { message: 'preferredLanguage must be an ISO 639-1 code' }) preferredLanguage?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) budgetMin?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY) budgetMax?: string;
  @ApiPropertyOptional({ pattern: '^[A-Z]{3}$' }) @IsOptional() @Matches(/^[A-Z]{3}$/) budgetCurrency?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() campaignId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() eventId?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES) priority?: LeadRow['priority'];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUuid({ each: true }) projectIds?: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() primaryProjectId?: string;
}

/** components.schemas.LeadCreate: at least one of phonePrimary or email is required. */
export class LeadCreateDto extends LeadFields {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) fullName!: string;
  @ApiProperty({ format: 'uuid' }) @IsUuid() sourceId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Optional. If empty, assignment rules choose the owner.' }) @IsOptional() @IsUuid() ownerUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

/** components.schemas.LeadUpdate */
export class LeadUpdateDto extends LeadFields {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) fullName?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() nextFollowUpAt?: string;
  @ApiProperty({ description: 'Optimistic lock: send the version you read' }) @IsInt() @Min(1) version!: number;
}

export class LeadExistsDto {
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiPropertyOptional(nullableUuid) ownerUserId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) ownerName!: string | null;
  @ApiPropertyOptional() stageName!: string;
}

export class CheckExistingQuery {
  @ApiPropertyOptional({ pattern: E164.source }) @IsOptional() @Matches(E164, { message: 'phone must be in E.164 format' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(lowerTrim) @IsEmail() email?: string;
}

export class CheckExistingResult {
  @ApiProperty() exists!: boolean;
  @ApiPropertyOptional({ type: LeadExistsDto, nullable: true }) lead!: LeadExistsDto | null;
}

// ---------------------------------------------------------------- actions
export class StageChangeDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() stageId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() reasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() nextFollowUpAt?: string;
}

export class AssignDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() toUserId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() reasonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class NoteDto {
  @ApiProperty({ minLength: 1 }) @IsString() @MinLength(1) @MaxLength(20000) body!: string;
}

export class PriorityDto {
  @ApiProperty({ enum: PRIORITIES }) @IsIn(PRIORITIES) priority!: LeadRow['priority'];
}

export class SetProjectsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUuid({ each: true }) projectIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() primaryProjectId?: string;
}

export class ShareDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() userId!: string;
  @ApiProperty({ enum: ['view', 'edit'] }) @IsIn(['view', 'edit']) access!: 'view' | 'edit';
}

export class LeadShareDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiPropertyOptional() userName?: string;
  @ApiProperty({ enum: ['view', 'edit'] }) access!: 'view' | 'edit';
  @ApiProperty({ format: 'uuid' }) sharedBy!: string;
  @ApiProperty({ format: 'date-time' }) sharedAt!: string;
}

export class LeadShareList {
  @ApiProperty({ type: [LeadShareDto] }) data!: LeadShareDto[];
}

export class AttachFileDto {
  @ApiProperty({ format: 'uuid' }) @IsUuid() fileId!: string;
  @ApiProperty() @IsIn(['document', 'image', 'brochure', 'floor_plan', 'contract', 'id_document', 'receipt', 'other']) category!:
    | 'document'
    | 'image'
    | 'brochure'
    | 'floor_plan'
    | 'contract'
    | 'id_document'
    | 'receipt'
    | 'other';
}

export class AttachmentDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiPropertyOptional() fileName?: string;
  @ApiProperty() category!: string;
  @ApiPropertyOptional({ format: 'date-time', readOnly: true }) createdAt!: string;
}

export class AttachmentList {
  @ApiProperty({ type: [AttachmentDto] }) data!: AttachmentDto[];
}

export class BulkLeadActionDto {
  @ApiProperty({ type: [String], maxItems: 500 }) @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUuid({ each: true }) leadIds!: string[];
  @ApiProperty({ enum: ['assign', 'stage', 'delete', 'restore'] }) @IsIn(['assign', 'stage', 'delete', 'restore']) action!: 'assign' | 'stage' | 'delete' | 'restore';
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() toUserId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() stageId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() reasonId?: string;
}

export class BulkFailure {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}

export class BulkResultDto {
  @ApiProperty({ type: [String] }) succeeded!: string[];
  @ApiProperty({ type: [BulkFailure] }) failed!: BulkFailure[];
}

// ---------------------------------------------------------------- timeline and enquiries
export class ActivityLinks {
  @ApiPropertyOptional() inquiryId?: string;
  @ApiPropertyOptional() taskId?: string;
  @ApiPropertyOptional() meetingId?: string;
  @ApiPropertyOptional() messageId?: string;
  @ApiPropertyOptional() fileId?: string;
  @ApiPropertyOptional() dealId?: string;
  @ApiPropertyOptional() financeDocumentId?: string;
  @ApiPropertyOptional() paymentId?: string;
}

export class ActivityDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: ACTIVITY_TYPES }) type!: ActivityRow['type'];
  @ApiProperty() summary!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) body!: string | null;
  @ApiPropertyOptional(nullableUuid) actorUserId!: string | null;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiPropertyOptional({ type: ActivityLinks }) links!: ActivityLinks;

  static from(a: ActivityRow): ActivityDto {
    const links: ActivityLinks = {};
    for (const key of ['inquiryId', 'taskId', 'meetingId', 'messageId', 'fileId', 'dealId', 'financeDocumentId', 'paymentId'] as const) {
      if (a[key]) links[key] = a[key]!;
    }
    return { id: a.id, type: a.type, summary: a.summary, body: a.body, actorUserId: a.actorUserId, occurredAt: a.occurredAt.toISOString(), links };
  }
}

export class ActivityPage {
  @ApiProperty({ type: [ActivityDto] }) data!: ActivityDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class TimelineQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Comma-separated activity types' }) @IsOptional() @IsString() @MaxLength(300) types?: string;
}

export class InquiryDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiPropertyOptional(nullableUuid) campaignId!: string | null;
  @ApiProperty() isReEnquiry!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) externalCampaignId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalAdsetId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalAdId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalFormId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) externalSubmissionId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) formName!: string | null;
  @ApiProperty({ type: Object }) formAnswers!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;

  static from(i: InquiryRow): InquiryDto {
    return {
      id: i.id,
      sourceId: i.sourceId,
      campaignId: i.campaignId,
      isReEnquiry: i.isReEnquiry,
      externalCampaignId: i.externalCampaignId,
      externalAdsetId: i.externalAdsetId,
      externalAdId: i.externalAdId,
      externalFormId: i.externalFormId,
      externalSubmissionId: i.externalSubmissionId,
      formName: i.formName,
      formAnswers: i.formAnswers,
      submittedAt: i.submittedAt.toISOString(),
      receivedAt: i.receivedAt.toISOString(),
    };
  }
}

export class InquiryList {
  @ApiProperty({ type: [InquiryDto] }) data!: InquiryDto[];
}

// ---------------------------------------------------------------- saved filters
export class SavedFilterDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ enum: SAVED_FILTER_ENTITIES }) entity!: SavedFilterRow['entity'];
  @ApiProperty() name!: string;
  @ApiProperty({ type: Object }) filters!: Record<string, unknown>;
  @ApiPropertyOptional({ type: [String] }) columns!: string[];
  @ApiPropertyOptional({ type: [String] }) sort!: string[];
  @ApiPropertyOptional(nullableUuid) sharedTeamId!: string | null;

  static from(f: SavedFilterRow): SavedFilterDto {
    return { id: f.id, entity: f.entity, name: f.name, filters: f.filters, columns: f.columns, sort: f.sort, sharedTeamId: f.sharedTeamId };
  }
}

export class SavedFilterList {
  @ApiProperty({ type: [SavedFilterDto] }) data!: SavedFilterDto[];
}

export class SavedFilterQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(SAVED_FILTER_ENTITIES) entity?: SavedFilterRow['entity'];
}

export class SavedFilterInputDto {
  @IsOptional() @IsUuid() id?: string;
  @ApiProperty({ enum: SAVED_FILTER_ENTITIES }) @IsIn(SAVED_FILTER_ENTITIES) entity!: SavedFilterRow['entity'];
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiProperty({ type: Object }) @IsObject() filters!: Record<string, unknown>;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) columns?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) sort?: string[];
  @ApiPropertyOptional(nullableUuid) @IsOptional() @IsUuid() sharedTeamId?: string | null;
}

// ---------------------------------------------------------------- search and workload
export class IdRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional() name?: string;
}

export class SearchResultDto {
  @ApiProperty({ type: [IdRefDto] }) leads!: IdRefDto[];
  @ApiPropertyOptional({ type: [IdRefDto] }) projects?: IdRefDto[];
  @ApiPropertyOptional({ type: [IdRefDto] }) units?: IdRefDto[];
  @ApiPropertyOptional({ type: [IdRefDto] }) users?: IdRefDto[];
}

export class SearchQuery {
  @ApiProperty({ description: 'Name, phone or email (min 2 characters)' }) @IsString() @MinLength(2) @MaxLength(100) q!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit: number = 10;
}

export class WorkloadDto {
  @ApiPropertyOptional() openLeads!: number;
  @ApiPropertyOptional() overdue!: number;
  @ApiPropertyOptional() missedLast30d!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) avgResponseMinutes!: number | null;
}
