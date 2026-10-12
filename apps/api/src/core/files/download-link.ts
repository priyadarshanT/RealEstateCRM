import { ApiProperty } from '@nestjs/swagger';

// components.schemas.DownloadLink
export class DownloadLink {
  @ApiProperty() url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
