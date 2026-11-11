import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/** A school's retention periods for student records; null turns a rule off. */
export class SchoolRetentionSettingsDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Erase a student record this many days after the student was made inactive (30 - 3650); null = never',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(30)
  @Max(3650)
  leaverRetentionDays!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Erase a student record once the last academic year they were enrolled in ended this many years ago (1 - 25); null = never',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(25)
  closedYearRetentionYears!: number | null;
}
