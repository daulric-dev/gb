import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** Points on a rubric follow the same two-decimal rule as marks. */
const TWO_DP = {
  maxDecimalPlaces: 2,
} as const;

export class RubricRatingDto {
  @ApiProperty({ example: 'Exemplary' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  /** At most the criterion's points. */
  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber(TWO_DP, { message: 'Points can have at most two decimal places' })
  @Min(0)
  points!: number;
}

export class RubricCriterionDto {
  @ApiProperty({ example: 'Argument' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /** What the criterion is worth; the rubric's total is the sum. */
  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber(TWO_DP, { message: 'Points can have at most two decimal places' })
  @Min(0)
  @Max(100000)
  points!: number;

  /** The levels, best first is the convention but any order is kept. */
  @ApiProperty({ type: [RubricRatingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RubricRatingDto)
  ratings!: RubricRatingDto[];
}

export class CreateRubricDto {
  @ApiProperty({ example: 'Essay rubric' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ type: [RubricCriterionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  criteria!: RubricCriterionDto[];
}

export class UpdateRubricDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  /**
   * Replaces every criterion. Refused once the rubric has been used to mark
   * anyone - copy it instead.
   */
  @ApiPropertyOptional({ type: [RubricCriterionDto] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  criteria?: RubricCriterionDto[];
}

export class AttachRubricDto {
  /** null detaches the rubric; existing marks are kept. */
  @ApiProperty({ nullable: true, format: 'uuid' })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  rubricId!: string | null;
}

export class CriterionAssessmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  criterionId!: string;

  /** The level picked. Omit to give points without a level. */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  ratingId?: string | null;

  /** Defaults to the level's points; 0..criterion points. */
  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(TWO_DP, { message: 'Marks can have at most two decimal places' })
  @Min(0)
  points?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

export class AssessRubricDto {
  @ApiProperty({ type: [CriterionAssessmentDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CriterionAssessmentDto)
  assessments!: CriterionAssessmentDto[];

  /**
   * Overrides the rubric's sum when given. Without it the score is the sum
   * of the criteria's points.
   */
  @ApiPropertyOptional({ example: 18.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(TWO_DP, { message: 'Marks can have at most two decimal places' })
  @Min(0)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}
