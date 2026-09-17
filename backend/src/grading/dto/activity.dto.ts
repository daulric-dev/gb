import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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
  @Type(() => Number) @IsNumber() @Min(1)
  points!: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowFile?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowText?: boolean;
}

export class UpdateActivityDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(1) points?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() gradingGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowFile?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowText?: boolean;
}

export class QuestionOptionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) label!: string;
  @ApiProperty() @IsBoolean() isCorrect!: boolean;
}

export class AddQuestionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) prompt!: string;

  @ApiProperty({ enum: ['multiple_choice', 'true_false'] })
  @IsIn(['multiple_choice', 'true_false'])
  kind!: 'multiple_choice' | 'true_false';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01)
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
  @ApiProperty() @IsUUID() optionId!: string;
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
  @Type(() => Number) @IsNumber() @Min(0)
  score!: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  feedback?: string;
}
