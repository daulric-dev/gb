import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Turn peer review on or off for an assignment, and how it runs. */
export class PeerReviewSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  /** How many classmates' submissions each student reviews (1-10). */
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  reviewsPerStudent!: number;

  /** Reviewers and authors never see each other's names. */
  @ApiProperty()
  @IsBoolean()
  anonymous!: boolean;

  /** after_due: opens at the due date. manual: when the teacher starts it. */
  @ApiProperty({ enum: ['after_due', 'manual'] })
  @IsIn(['after_due', 'manual'])
  openMode!: 'after_due' | 'manual';

  @ApiProperty({ example: '2026-12-01T17:00:00.000Z' })
  @IsDateString()
  closesAt!: string;

  /** A course rubric to review against; null for a comment-only form. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  rubricId?: string | null;

  /**
   * Points for review quality, marked by the teacher in a separate gradebook
   * column; null when review quality does not count.
   */
  @ApiPropertyOptional({ nullable: true, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000)
  qualityPoints?: number | null;
}

export class ReviewMarkDto {
  @ApiProperty()
  @IsUUID()
  criterionId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  ratingId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  points?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

/** A reviewer saves (and optionally submits) their review. */
export class SaveReviewDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comment?: string | null;

  @ApiPropertyOptional({ type: [ReviewMarkDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReviewMarkDto)
  marks?: ReviewMarkDto[];

  /** Hand the review in. It can still be edited until the window closes. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

/** Give a submission another reviewer, by hand. */
export class AddAllocationDto {
  @ApiProperty()
  @IsUUID()
  reviewerId!: string;

  @ApiProperty()
  @IsUUID()
  submissionId!: string;
}

/** Move a review to another student. */
export class ReassignAllocationDto {
  @ApiProperty()
  @IsUUID()
  reviewerId!: string;
}

/** Hide an inappropriate review from its author, or show it again. */
export class HideReviewDto {
  @ApiProperty()
  @IsBoolean()
  hidden!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}
