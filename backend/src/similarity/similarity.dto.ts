import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

/** A school's similarity check settings. */
export class SimilaritySettingsDto {
  /** activity: the same activity only. school: also the school's recent work. */
  @ApiProperty({ enum: ['activity', 'school'] })
  @IsIn(['activity', 'school'])
  pool!: 'activity' | 'school';

  /** With the school pool: how many recent terms to compare against. */
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  poolTerms!: number;

  /** Percent at or above which teachers see a marker. */
  @ApiProperty({ example: 40 })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  threshold!: number;
}
