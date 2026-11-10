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
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { LATE_PENALTY_MODES, type LatePenaltyMode } from '../late-policy';
import { QUESTION_KINDS, type QuestionKind } from '../quiz-questions';

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

  /** Optional quiz timer in minutes; null/omitted means untimed. */
  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 1440, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  timeLimitMinutes?: number | null;

  /** Optional lockdown browser requirement (quiz only). */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  lockdownBrowser?: boolean;


  /** Quiz only: each student gets the questions in their own order. */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean;

  /** Quiz only: each student gets choice options in their own order. */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean;

  /**
   * Accept late work until then (after dueAt). Omit or null to close at the
   * due date.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  lateUntil?: string | null;

  /** Penalty per started day or hour late; `none` by default. */
  @ApiPropertyOptional({ enum: LATE_PENALTY_MODES })
  @IsOptional()
  @IsIn(LATE_PENALTY_MODES)
  latePenaltyMode?: LatePenaltyMode;

  /** Percent per day or hour, more than 0 and at most 100. */
  @ApiPropertyOptional({ example: 10, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  latePenaltyValue?: number | null;

  /** The most the penalty can take, in percent. Null for no cap below 100. */
  @ApiPropertyOptional({ example: 50, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  latePenaltyCap?: number | null;
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

  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 1440, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  timeLimitMinutes?: number | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  lockdownBrowser?: boolean;


  /** Quiz only: each student gets the questions in their own order. */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean;

  /** Quiz only: each student gets choice options in their own order. */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  shuffleOptions?: boolean;

  /**
   * Accept late work until then (after dueAt). Omit or null to close at the
   * due date.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  lateUntil?: string | null;

  /** Penalty per started day or hour late; `none` by default. */
  @ApiPropertyOptional({ enum: LATE_PENALTY_MODES })
  @IsOptional()
  @IsIn(LATE_PENALTY_MODES)
  latePenaltyMode?: LatePenaltyMode;

  /** Percent per day or hour, more than 0 and at most 100. */
  @ApiPropertyOptional({ example: 10, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  latePenaltyValue?: number | null;

  /** The most the penalty can take, in percent. Null for no cap below 100. */
  @ApiPropertyOptional({ example: 50, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  latePenaltyCap?: number | null;
}

/** Waive or restore one student's late penalty. */
export class WaiveLatePenaltyDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  waived!: boolean;
}

export class QuizPresenceDto {
  @ApiProperty({ description: 'True if the student is away from the quiz tab/window' })
  @IsBoolean()
  isAway!: boolean;

  @ApiPropertyOptional({ description: 'Reason for being away (e.g. tab_hidden, window_blur, fullscreen_exit)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;
}

export class QuestionOptionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) label!: string;

  /** Choice kinds: whether this option is right. Ignored by matching and ordering. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCorrect?: boolean;

  /** Matching: the right-hand item this one matches. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  matchLabel?: string | null;
}

/** Per-kind settings, shared by adding and editing a question. */
class QuestionSettingsDto {
  /** Numeric: the answer. */
  @ApiPropertyOptional({ nullable: true, example: 3.14 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  numericAnswer?: number | null;

  /** Numeric: how far from the answer still counts (absolute, 0 or more). */
  @ApiPropertyOptional({ nullable: true, example: 0.01 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  numericTolerance?: number | null;

  /** Multiple select, matching, ordering: all or nothing (default) or partial credit. */
  @ApiPropertyOptional({ enum: ['all_or_nothing', 'partial'] })
  @IsOptional()
  @IsIn(['all_or_nothing', 'partial'])
  scoring?: 'all_or_nothing' | 'partial';

  /** Essay: a course rubric to mark with (a guide; the mark is points). */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  rubricId?: string | null;

  /** File upload: extensions (.pdf) or MIME types (image/*); empty accepts any. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  fileTypes?: string[];

  /** File upload: a lower size limit than the school's, in MB. */
  @ApiPropertyOptional({ nullable: true, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  fileMaxMb?: number | null;
}

export class UpdateQuestionDto extends QuestionSettingsDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
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

export class AddQuestionDto extends QuestionSettingsDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(2000) prompt!: string;

  @ApiProperty({ enum: QUESTION_KINDS })
  @IsIn(QUESTION_KINDS)
  kind!: QuestionKind;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  points?: number;

  /**
   * Choices (multiple choice, true/false, multiple select), accepted
   * wordings (short answer), pairs (matching: label and matchLabel) or items
   * in the right order (ordering). Omit for numeric, essay and file upload.
   */
  @ApiPropertyOptional({ type: [QuestionOptionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

export class SubmitAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_BODY)
  textBody?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fileId?: string;
}

export class QuizMatchDto {
  @ApiProperty() @IsUUID() optionId!: string;
  @ApiProperty() @IsString() @MaxLength(300) label!: string;
}

/**
 * One answer. Which field is used depends on the question's kind; an answer
 * of the wrong shape for its question is dropped.
 */
export class QuizAnswerDto {
  @ApiProperty() @IsUUID() questionId!: string;

  /** Multiple choice, true/false: the chosen option. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  optionId?: string;

  /** Multiple select: the chosen options. Ordering: every item, in order. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @IsUUID('all', { each: true })
  optionIds?: string[];

  /** Matching: the right-hand item chosen for each left-hand item. */
  @ApiPropertyOptional({ type: [QuizMatchDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuizMatchDto)
  matches?: QuizMatchDto[];

  /** Short answer (at most 500 characters) or essay. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_BODY)
  text?: string;

  /** Numeric. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  numeric?: number;

  /** File upload: the student's finished upload for this question. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fileId?: string;
}

export class SubmitQuizDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ANSWERS)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}

export class SaveQuizAnswersDto {
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

/** The teacher's points on one essay or file question. */
export class MarkQuestionDto {
  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Marks can have at most two decimal places' },
  )
  @Min(0)
  points!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}
