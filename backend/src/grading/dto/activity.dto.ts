import {
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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListActivitiesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  termId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subjectId?: string;
}

export class CreateActivityDto {
  @ApiProperty() @IsUUID() classId!: string;
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty() @IsUUID() termId!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() gradingGroupId?: string;

  @ApiProperty({ enum: ['quiz', 'assignment'] })
  @IsIn(['quiz', 'assignment'])
  kind!: 'quiz' | 'assignment';

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  points!: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowFile?: boolean;
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

export class ExcludeActivityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  excluded!: boolean;
}

/** One student's mark, rather than the whole activity. */
export class ExcludeStudentGradeDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  excluded!: boolean;

  @ApiPropertyOptional({ example: 'Absent, sat the makeup instead' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  points?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() gradingGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowFile?: boolean;
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

export class QuestionOptionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) label!: string;
  @ApiProperty() @IsBoolean() isCorrect!: boolean;
}

export class UpdateQuestionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  prompt?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  points?: number;

  /** The whole list, in order. Omit to leave the options alone. */
  @ApiPropertyOptional({ type: [QuestionOptionDto] })
  @IsOptional()
  @IsArray()
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
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options!: QuestionOptionDto[];
}

export class SubmitAssignmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() textBody?: string;
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
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}

export class GradeSubmissionDto {
  @ApiProperty({ example: 85 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}
