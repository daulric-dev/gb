import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CALCULATIONS, MAX_LEVELS, MIN_LEVELS, type Calculation } from '../mastery.calc';

export class ScoreBandDto {
  @ApiProperty({ minimum: 0, maximum: 100, example: 70 })
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercent!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_LEVELS, example: 3 })
  @IsInt()
  @Min(1)
  @Max(MAX_LEVELS)
  level!: number;
}

/** PUT /mastery/settings: any subset; the result must be a valid scale. */
export class MasterySettingsDto {
  @ApiPropertyOptional({ type: [String], example: ['Beginning', 'Developing', 'Proficient', 'Exceeding'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(MIN_LEVELS)
  @ArrayMaxSize(MAX_LEVELS)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  levels?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LEVELS })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_LEVELS)
  masteryThreshold?: number;

  @ApiPropertyOptional({ enum: CALCULATIONS })
  @IsOptional()
  @IsIn(CALCULATIONS)
  calculation?: Calculation;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 0.99, example: 0.65 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(0.99)
  decayWeight?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  minEvidence?: number;

  @ApiPropertyOptional({ type: [ScoreBandDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LEVELS)
  @ValidateNested({ each: true })
  @Type(() => ScoreBandDto)
  scoreBands?: ScoreBandDto[];

  @ApiPropertyOptional({ description: 'Report cards show an outcomes section per course.' })
  @IsOptional()
  @IsBoolean()
  reportCardSection?: boolean;
}

export class OutcomeSetDto {
  @ApiProperty({ example: 'National Curriculum: Mathematics' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateOutcomeSetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'true archives, false restores.' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ImportOutcomesDto {
  @ApiProperty({ description: 'CSV with a header: code,title[,description,subject,grade_level,parent_code]' })
  @IsString()
  @MinLength(1)
  @MaxLength(2_000_000)
  csv!: string;

  @ApiPropertyOptional({ description: 'A new set\'s title (when setId is not given).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Add to (and update by code in) this existing set.' })
  @IsOptional()
  @IsUUID()
  setId?: string;

  @ApiPropertyOptional({ description: 'Check the file and report what would change; nothing is written.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class OutcomeDto {
  @ApiProperty({ example: 'MA.4.NF.1' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Explain why fractions are equivalent' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  subject?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50)
  gradeLevel?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'An outcome in the same set or course.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;
}

export class UpdateOutcomeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  subject?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50)
  gradeLevel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;

  @ApiPropertyOptional({ description: 'true archives, false restores.' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

/** POST /courses/:courseId/outcome-alignments: exactly one target. */
export class AlignmentDto {
  @ApiProperty()
  @IsUUID()
  outcomeId!: string;

  @ApiPropertyOptional({ description: 'The whole activity.' })
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional({ description: 'A rubric row (criterion) of a rubric in this course.' })
  @IsOptional()
  @IsUUID()
  criterionId?: string;

  @ApiPropertyOptional({ description: 'A quiz question (or question bank question) in this course.' })
  @IsOptional()
  @IsUUID()
  questionId?: string;
}

export class OutcomeListQueryDto {
  @ApiPropertyOptional({ description: 'Include archived sets.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: 'true' | 'false';
}
