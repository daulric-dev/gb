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

/**
 * What the browser declares before a resumable upload starts. Every field is
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
  @Max(10 * 1024 * 1024)
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
