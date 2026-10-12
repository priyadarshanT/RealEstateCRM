import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// components.schemas.AuditEntry (owner console: userId is the platform admin)
export class AuditEntryDtoDoc {
  @ApiProperty() id!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) userId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) entityId!: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) changes!: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String, nullable: true }) ipAddress!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
