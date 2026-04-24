import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateResumableUploadDto {
  @ApiProperty({ example: 'avatar.png' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @ApiProperty({ example: 204800 })
  @IsNumber()
  @Min(1)
  totalSize: number;

  @ApiPropertyOptional({ example: 'avatars' })
  @IsString()
  @IsOptional()
  pathname?: string;
}
