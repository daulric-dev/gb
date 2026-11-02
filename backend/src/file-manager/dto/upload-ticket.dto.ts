import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MB, SCHOOL_UPLOAD_MB_RANGE } from '../upload-limit.config';

/**
 * What the client declares before a direct upload starts. Every field is
 * checked again against the stored bytes when the upload is finalised, so this
 * is a fast rejection, not the security boundary.
 */
export class CreateUploadTicketDto {
  @ApiProperty({ example: 'coursework.pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 1048576 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Only the outer bound: the school's own limit (and the platform ceiling,
  // which can change with the env) is checked by the service.
  @Max(SCHOOL_UPLOAD_MB_RANGE.max * MB)
  sizeBytes!: number;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  contentType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
