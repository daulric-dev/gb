import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SCHOOL_UPLOAD_MB_RANGE } from '@/file-manager/upload-limit.config';

export class UpdateUploadLimitDto {
  @ApiProperty({
    example: 25,
    nullable: true,
    description:
      'Largest upload in MB, or null for the platform default. The service also refuses values above UPLOAD_MAX_MB.',
  })
  // Required, but null is a value: it resets the school to the default.
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(SCHOOL_UPLOAD_MB_RANGE.min)
  @Max(SCHOOL_UPLOAD_MB_RANGE.max)
  maxUploadMb!: number | null;
}
