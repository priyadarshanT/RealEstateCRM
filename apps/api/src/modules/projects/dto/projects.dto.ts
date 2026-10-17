import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PageInfo, PageQuery } from '../../../core/http/pagination';
import { IsDateOnly, IsUuid } from '../../../core/http/validators';
import { BuildingRow, CONSTRUCTION_STATUSES, DeveloperRow, PROJECT_CATEGORIES, ProjectRow, PROPERTY_TYPES, UNIT_STATUSES, UnitChangeRow, UnitRow, UnitStatus } from '../projects.schema';

const MONEY = /^\d+(\.\d{1,2})?$/;
const nullableString = { type: String, nullable: true } as const;
const nullableUuid = { type: String, format: 'uuid', nullable: true } as const;
const nullableDate = { type: String, format: 'date', nullable: true } as const;
const money = (v: string | null) => (v === null ? null : Number(v).toFixed(2));
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// ---------------------------------------------------------------- developers (components.schemas.Developer)
export class DeveloperDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableString) trn!: string | null;
  @ApiPropertyOptional(nullableString) contactName!: string | null;
  @ApiPropertyOptional(nullableString) email!: string | null;
  @ApiPropertyOptional(nullableString) phone!: string | null;
  @ApiPropertyOptional(nullableString) address!: string | null;
  @ApiPropertyOptional(nullableString) website!: string | null;

  static from(d: DeveloperRow): DeveloperDto {
    return { id: d.id, name: d.name, trn: d.trn, contactName: d.contactName, email: d.email, phone: d.phone, address: d.address, website: d.website };
  }
}

export class DeveloperPage {
  @ApiProperty({ type: [DeveloperDto] }) data!: DeveloperDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class DeveloperInputDto {
  @IsOptional() id?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(50) trn?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) contactName?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) email?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) website?: string | null;
}

// ---------------------------------------------------------------- projects (components.schemas.Project)
export class InventoryDto {
  @ApiProperty() available!: number;
  @ApiProperty() onHold!: number;
  @ApiProperty() booked!: number;
  @ApiProperty() sold!: number;
}

export class ProjectDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) developerId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional(nullableString) community!: string | null;
  @ApiPropertyOptional() city!: string;
  @ApiPropertyOptional(nullableString) address!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) latitude!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) longitude!: number | null;
  @ApiPropertyOptional(nullableString) description!: string | null;
  @ApiProperty({ enum: CONSTRUCTION_STATUSES }) constructionStatus!: ProjectRow['constructionStatus'];
  @ApiPropertyOptional(nullableDate) handoverDate!: string | null;
  @ApiPropertyOptional(nullableString) paymentPlan!: string | null;
  @ApiPropertyOptional(nullableUuid) brochureFileId!: string | null;
  @ApiPropertyOptional() isActive!: boolean;
  @ApiPropertyOptional({ type: InventoryDto, readOnly: true }) inventory!: InventoryDto;
  @ApiProperty({ enum: PROJECT_CATEGORIES }) category!: ProjectRow['category'];
  @ApiPropertyOptional({ ...nullableUuid, description: 'Assigned To: person responsible for the project' }) assignedUserId!: string | null;
  @ApiPropertyOptional({ type: Object, description: 'Custom field values by key' }) customValues!: Record<string, unknown>;
  @ApiPropertyOptional({ type: () => StartingPriceDto, nullable: true, readOnly: true, description: 'Lowest price of an available unit' }) startingPrice!: StartingPriceDto | null;
  @ApiPropertyOptional({ format: 'date-time', readOnly: true }) createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time', readOnly: true }) updatedAt!: string;

  static from(p: ProjectRow, inventory: InventoryDto, startingPrice: StartingPriceDto | null = null): ProjectDto {
    return {
      id: p.id,
      developerId: p.developerId,
      name: p.name,
      community: p.community,
      city: p.city,
      address: p.address,
      latitude: p.latitude === null ? null : Number(p.latitude),
      longitude: p.longitude === null ? null : Number(p.longitude),
      description: p.description,
      constructionStatus: p.constructionStatus,
      handoverDate: p.handoverDate,
      paymentPlan: p.paymentPlan,
      brochureFileId: p.brochureFileId,
      isActive: p.isActive,
      inventory,
      category: p.category,
      assignedUserId: p.assignedUserId,
      customValues: p.customValues ?? {},
      startingPrice,
      createdAt: p.createdAt.toISOString(),
      updatedAt: new Date(p.updatedAt).toISOString(),
    };
  }
}

export class StartingPriceDto {
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
}

export class ProjectPage {
  @ApiProperty({ type: [ProjectDto] }) data!: ProjectDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo & { total?: number };
}

export class CategoryCountDto {
  @ApiProperty({ enum: PROJECT_CATEGORIES }) category!: ProjectRow['category'];
  @ApiProperty() count!: number;
}

export class CategoryCountList {
  @ApiProperty({ type: [CategoryCountDto] }) data!: CategoryCountDto[];
  @ApiProperty({ description: 'All categories together' }) total!: number;
}

/** Dates the Project page range can filter (Created, Updated, Handover). */
export const PROJECT_DATE_FIELDS = ['created', 'updated', 'handover'] as const;

export class ProjectListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() developerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: PROJECT_CATEGORIES }) @IsOptional() @IsIn(PROJECT_CATEGORIES) category?: ProjectRow['category'];
  @ApiPropertyOptional({ enum: CONSTRUCTION_STATUSES }) @IsOptional() @IsIn(CONSTRUCTION_STATUSES) constructionStatus?: ProjectRow['constructionStatus'];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() assignedUserId?: string;
  @ApiPropertyOptional({ enum: PROJECT_DATE_FIELDS, description: 'Which date dateFrom / dateTo filter (default created)' }) @IsOptional() @IsIn(PROJECT_DATE_FIELDS) dateField?: (typeof PROJECT_DATE_FIELDS)[number];
  @ApiPropertyOptional({ format: 'date', description: 'Company time zone' }) @IsOptional() @IsDateOnly() dateFrom?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Company time zone; the end date is included' }) @IsOptional() @IsDateOnly() dateTo?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() total?: boolean;
}

export class ProjectInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() inventory?: unknown;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() developerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) community?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) city?: string;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) description?: string | null;
  @ApiPropertyOptional({ enum: CONSTRUCTION_STATUSES }) @IsOptional() @IsIn(CONSTRUCTION_STATUSES) constructionStatus?: ProjectRow['constructionStatus'];
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() handoverDate?: string | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) paymentPlan?: string | null;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() brochureFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: PROJECT_CATEGORIES }) @IsOptional() @IsIn(PROJECT_CATEGORIES) category?: ProjectRow['category'];
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() assignedUserId?: string | null;
  @ApiPropertyOptional({ type: Object, description: 'Custom field values by key (null clears one)' }) @IsOptional() @IsObject() customValues?: Record<string, unknown>;
  @IsOptional() startingPrice?: unknown;
  @IsOptional() createdAt?: unknown;
  @IsOptional() updatedAt?: unknown;
}

// ---------------------------------------------------------------- buildings (components.schemas.Building)
export class BuildingDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) floors!: number | null;
  @ApiPropertyOptional(nullableDate) handoverDate!: string | null;

  static from(b: BuildingRow): BuildingDto {
    return { id: b.id, projectId: b.projectId, name: b.name, floors: b.floors, handoverDate: b.handoverDate };
  }
}

export class BuildingList {
  @ApiProperty({ type: [BuildingDto] }) data!: BuildingDto[];
}

export class BuildingInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() projectId?: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(300) floors?: number | null;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() handoverDate?: string | null;
}

// ---------------------------------------------------------------- units (components.schemas.Unit)
export class UnitDto {
  @ApiProperty({ format: 'uuid', readOnly: true }) id!: string;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiPropertyOptional(nullableUuid) buildingId!: string | null;
  @ApiProperty() unitNumber!: string;
  @ApiProperty({ enum: PROPERTY_TYPES }) propertyType!: UnitRow['propertyType'];
  @ApiProperty({ minimum: 0 }) bedrooms!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) bathrooms!: number | null;
  @ApiProperty() sizeSqft!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) floor!: number | null;
  @ApiPropertyOptional(nullableString) view!: string | null;
  @ApiProperty({ example: '3250000.00' }) price!: string;
  @ApiProperty({ example: 'AED' }) currency!: string;
  @ApiPropertyOptional(nullableString) paymentPlan!: string | null;
  @ApiPropertyOptional(nullableDate) handoverDate!: string | null;
  @ApiProperty({ enum: UNIT_STATUSES, readOnly: true }) status!: UnitStatus;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) holdExpiresAt!: string | null;
  @ApiPropertyOptional(nullableUuid) floorPlanFileId!: string | null;

  static from(u: UnitRow): UnitDto {
    return {
      id: u.id,
      projectId: u.projectId,
      buildingId: u.buildingId,
      unitNumber: u.unitNumber,
      propertyType: u.propertyType,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      sizeSqft: Number(u.sizeSqft),
      floor: u.floor,
      view: u.view,
      price: money(u.price)!,
      currency: u.currency,
      paymentPlan: u.paymentPlan,
      handoverDate: u.handoverDate,
      status: u.status,
      holdExpiresAt: u.holdExpiresAt?.toISOString() ?? null,
      floorPlanFileId: u.floorPlanFileId,
    };
  }
}

export class UnitPage {
  @ApiProperty({ type: [UnitDto] }) data!: UnitDto[];
  @ApiProperty({ type: PageInfo }) page!: PageInfo;
}

export class UnitListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() buildingId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PROPERTY_TYPES) propertyType?: UnitRow['propertyType'];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) bedrooms?: number;
  @ApiPropertyOptional({ example: '3250000.00' }) @IsOptional() @Matches(MONEY) priceMin?: string;
  @ApiPropertyOptional({ example: '3250000.00' }) @IsOptional() @Matches(MONEY) priceMax?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(UNIT_STATUSES) status?: UnitStatus;
}

export class UnitInputDto {
  @IsOptional() id?: unknown;
  @IsOptional() status?: unknown;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUuid() projectId?: string;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() buildingId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(30) unitNumber?: string;
  @ApiPropertyOptional({ enum: PROPERTY_TYPES }) @IsOptional() @IsIn(PROPERTY_TYPES) propertyType?: UnitRow['propertyType'];
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) @Max(20) bedrooms?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(20) bathrooms?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) sizeSqft?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(-10) @Max(300) floor?: number | null;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) view?: string | null;
  @ApiPropertyOptional({ example: '3250000.00' }) @IsOptional() @Matches(MONEY) price?: string;
  @ApiPropertyOptional({ example: 'AED' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional(nullableString) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) paymentPlan?: string | null;
  @ApiPropertyOptional(nullableDate) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateOnly() handoverDate?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) @IsOptional() holdExpiresAt?: unknown;
  @ApiPropertyOptional(nullableUuid) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUuid() floorPlanFileId?: string | null;
}

/** components.schemas.UnitStatusChange: send status and/or price. */
export class UnitStatusChangeDto {
  @ApiPropertyOptional({ enum: UNIT_STATUSES }) @IsOptional() @IsIn(UNIT_STATUSES) status?: UnitStatus;
  @ApiPropertyOptional({ example: '3250000.00' }) @IsOptional() @Matches(MONEY) price?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T/) holdExpiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UnitChangeDto {
  @ApiPropertyOptional(nullableString) oldStatus!: string | null;
  @ApiPropertyOptional(nullableString) newStatus!: string | null;
  @ApiPropertyOptional(nullableString) oldPrice!: string | null;
  @ApiPropertyOptional(nullableString) newPrice!: string | null;
  @ApiPropertyOptional(nullableString) reason!: string | null;
  @ApiPropertyOptional(nullableUuid) changedBy!: string | null;
  @ApiProperty({ format: 'date-time' }) changedAt!: string;

  static from(c: UnitChangeRow): UnitChangeDto {
    return { oldStatus: c.oldStatus, newStatus: c.newStatus, oldPrice: money(c.oldPrice), newPrice: money(c.newPrice), reason: c.reason, changedBy: c.changedBy, changedAt: c.changedAt.toISOString() };
  }
}

export class UnitChangeList {
  @ApiProperty({ type: [UnitChangeDto] }) data!: UnitChangeDto[];
}

/** POST /projects/{id}/attachments: a file with its category and gallery position. */
export class ProjectAttachDto {
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
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
