import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FilesService, MAX_FILE_BYTES, UPLOAD_PURPOSES, UploadPurpose } from './files.service';

const PURPOSES = Object.keys(UPLOAD_PURPOSES) as UploadPurpose[];

class UploadRequestDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) fileName!: string;
  @ApiProperty() @IsString() @MaxLength(150) mimeType!: string;
  // Larger sizes are refused by the service with 422 FILE_TOO_LARGE (API guide §6).
  @ApiProperty({ maximum: MAX_FILE_BYTES }) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) sizeBytes!: number;
  @ApiProperty({ enum: PURPOSES }) @IsIn(PURPOSES) purpose!: UploadPurpose;
}

class UploadTicketDto {
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiProperty({ description: 'PUT the file bytes here within 10 minutes' }) uploadUrl!: string;
  @ApiPropertyOptional({ type: Object }) headers?: Record<string, string>;
}

class UploadDoneDto {
  @ApiProperty({ format: 'uuid' }) fileId!: string;
  @ApiProperty() sizeBytes!: number;
}

class DownloadLinkDto {
  @ApiProperty() url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

@ApiTags('Files')
@ApiBearerAuth('bearer')
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('files/uploads')
  @ApiOperation({ operationId: 'requestUpload', summary: 'Request an upload link' })
  @ApiCreatedResponse({ type: UploadTicketDto })
  requestUpload(@Body() body: UploadRequestDto): Promise<UploadTicketDto> {
    return this.files.requestUpload(body);
  }

  @Post('files/:id/complete')
  @HttpCode(200)
  @ApiOperation({ operationId: 'confirmUpload', summary: 'Confirm an upload' })
  @ApiOkResponse({ type: UploadDoneDto })
  complete(@Param('id', ParseUUIDPipe) id: string): Promise<UploadDoneDto> {
    return this.files.complete(id);
  }

  @Get('files/:id/download')
  @ApiOperation({ operationId: 'getDownloadLink', summary: 'Get a download link' })
  @ApiOkResponse({ type: DownloadLinkDto })
  download(@Param('id', ParseUUIDPipe) id: string): Promise<DownloadLinkDto> {
    return this.files.downloadLink(id);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removeAttachment', summary: 'Remove an attachment' })
  @ApiNoContentResponse({ description: 'Done' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.files.removeAttachment(id);
  }
}
