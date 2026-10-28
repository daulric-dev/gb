import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** Generous caps: far above real use, low enough to refuse abuse. */
const MAX_INSTRUCTIONS = 50_000;
const MAX_TEXT_BODY = 50_000;
const MAX_OPTIONS = 50;
const MAX_ANSWERS = 500;

export class CreateActivityDto {
  /**
   * `offline` is marked but never handed in online - paper tests, practicals,
   * marks carried over from the old gradebook.
   */
  @ApiProperty({ enum: ['quiz', 'assignment', 'offline'] })
  @IsIn(['quiz', 'assignment', 'offline'])
  kind!: 'quiz' | 'assignment' | 'offline';

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_INSTRUCTIONS)
  instructions?: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  points!: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;

  /** Must be one of this course's groups; omit for Ungrouped. */
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignmentGroupId?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowFile?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowMultipleFiles?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowText?: boolean;

  /**
   * How many times a student may sit a quiz. Omit for a single attempt; 0
   * means unlimited.
   */
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAttempts?: number;
}

/** Excuse one student from one piece of work, keeping any mark they have. */
export class ExcuseSubmissionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  excused!: boolean;

  @ApiPropertyOptional({ example: 'Absent, sat the makeup instead' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateActivityDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_INSTRUCTIONS)
  instructions?: string | null;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  points?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string | null;

  /** null moves the activity to Ungrouped. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  assignmentGroupId?: string | null;

  /** Keep the marks but leave them out of the course total. */
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  omitFromFinalGrade?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  allowFile?: boolean;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  allowMultipleFiles?: boolean;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  allowText?: boolean;

  /**
   * How many times a student may sit a quiz. Omit for a single attempt; 0
   * means unlimited.
   */
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAttempts?: number | null;
}

export class QuestionOptionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) label!: string;
  @ApiProperty() @IsBoolean() isCorrect!: boolean;
}

export class UpdateQuestionDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  prompt?: string;

  @ApiPropertyOptional({ example: 1 })
  @ValidateIf((_, v) => v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  points?: number;

  /** The whole list, in order. Omit to leave the options alone. */
  @ApiPropertyOptional({ type: [QuestionOptionDto] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

export class AddQuestionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) prompt!: string;

  @ApiProperty({ enum: ['multiple_choice', 'true_false', 'short_answer'] })
  @IsIn(['multiple_choice', 'true_false', 'short_answer'])
  kind!: 'multiple_choice' | 'true_false' | 'short_answer';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  points?: number;

  @ApiProperty({ type: [QuestionOptionDto] })
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options!: QuestionOptionDto[];
}

export class SubmitAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_BODY)
  textBody?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fileId?: string;
}

export class QuizAnswerDto {
  @ApiProperty() @IsUUID() questionId!: string;

  /** The chosen option, for the kinds answered by picking one. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  optionId?: string;

  /** What the student typed, for a short answer. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
}

export class SubmitQuizDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ANSWERS)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}

export class GradeSubmissionDto {
  // Marks are shown to two decimals everywhere, so that is all a teacher
  // may type; a quiz's auto score is the only longer fraction, and it is
  // rounded on the way out.
  @ApiProperty({ example: 85 })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Marks can have at most two decimal places' },
  )
  @Min(0)
  score!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}
