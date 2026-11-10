import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AI_MAX_PAGE_CHARS,
  AI_MAX_QUESTIONS,
  AI_MAX_SOURCE_CHARS,
  AI_MAX_SYLLABUS_CHARS,
  AI_PLAN_ITEM_KINDS,
  AI_PLAN_MAX_ITEMS,
  AI_PLAN_MAX_MODULES,
  AI_PLAN_MAX_OUTCOMES,
  AI_PROVIDER_KINDS,
  AI_QUESTION_KINDS,
  AI_SUBMISSION_TYPES,
  type AiPlanItemKind,
  type AiProviderKind,
  type AiQuestionKind,
  type AiSubmissionType,
} from './ai.constants';

export class CreateAiProviderDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @ApiProperty({ enum: AI_PROVIDER_KINDS }) @IsIn(AI_PROVIDER_KINDS) kind!: AiProviderKind;
  /** anthropic: optional override; openai_compatible: required. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) baseUrl?: string;
  /** Default for anthropic: claude-opus-5-5. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) model?: string;
  /** Write-only. */
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000) apiKey!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  monthlyCap?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  /** The provider runs on the organisation's private network (http and private addresses allowed for it). Default false. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPrivateNetwork?: boolean;
  /** Schools may choose it in their AI settings. Default true. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() availableToSchools?: boolean;
}

export class UpdateAiProviderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  /** Empty clears an anthropic override; required for openai_compatible. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) baseUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) model?: string;
  /** Write-only: a non-empty value replaces the stored key. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) apiKey?: string;
  /** null removes the cap. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  monthlyCap?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowPrivateNetwork?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() availableToSchools?: boolean;
}

export class AiOrgSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keepPrompts?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) userHourlyLimit?: number;
}

export class AiSchoolSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowStudentWork?: boolean;
  /**
   * One of the organisation's providers that is available to schools, or
   * null for the organisation default. Left out: unchanged.
   */
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  providerId?: string | null;
}

export class QuizDraftDto {
  /** A page of this course to write from (or `text`). */
  @ApiPropertyOptional() @IsOptional() @IsUUID() pageId?: string;
  /** Pasted text to write from (or `pageId`). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(AI_MAX_SOURCE_CHARS) text?: string;
  @ApiProperty({ minimum: 1, maximum: AI_MAX_QUESTIONS })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AI_MAX_QUESTIONS)
  count!: number;
  @ApiProperty({ enum: AI_QUESTION_KINDS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_QUESTION_KINDS.length)
  @IsIn(AI_QUESTION_KINDS, { each: true })
  kinds!: AiQuestionKind[];
}

export class RubricFeedbackDto {
  @ApiProperty() @IsUUID() studentId!: string;
}

export class PageSummaryDto {
  /** The editor's current (unsaved) text; the saved page when omitted. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(AI_MAX_SOURCE_CHARS) text?: string;
}

// ── course building ─────────────────────────────────────────────────────

export const OUTLINE_MIXES = ['balanced', 'more_quizzes', 'more_assignments', 'quizzes_only', 'assignments_only'] as const;
export type OutlineMix = (typeof OUTLINE_MIXES)[number];

/** "Plan this course with AI": what the teacher tells the AI. Only teacher material is sent. */
export class OutlineDraftDto {
  @ApiProperty({ example: 'Biology' }) @IsString() @IsNotEmpty() @MaxLength(200) subject!: string;
  /** Level / grade, e.g. "Year 9" or "Grade 4". */
  @ApiProperty({ example: 'Year 9' }) @IsString() @IsNotEmpty() @MaxLength(100) level!: string;
  /** Course length in weeks (or `units`; one of them is enough). */
  @ApiPropertyOptional({ minimum: 1, maximum: 52 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(52) weeks?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: AI_PLAN_MAX_MODULES })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(AI_PLAN_MAX_MODULES) units?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) goals?: string;
  /** A pasted syllabus or scheme of work. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(AI_MAX_SYLLABUS_CHARS) syllabus?: string;
  /** About how many assessments (quizzes and assignments) in total. */
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) assessments?: number;
  @ApiPropertyOptional({ enum: OUTLINE_MIXES }) @IsOptional() @IsIn(OUTLINE_MIXES) mix?: OutlineMix;
  /** Ask for learning outcomes per module (used only while mastery is on for the school). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() outcomes?: boolean;
  /** Put assessments in assignment groups (default true). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() groups?: boolean;
}

/** One item of a plan the teacher reviewed (the outline's or a module suggestion's). */
export class PlanItemDto {
  @ApiProperty({ enum: AI_PLAN_ITEM_KINDS }) @IsIn(AI_PLAN_ITEM_KINDS) kind!: AiPlanItemKind;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  /** Page: an outline (the page's starting text); assignment: instructions; quiz: its topic. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 1000 })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000)
  points?: number | null;
  /** Weeks after the course start the item is due (0 = the first week). */
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 104 })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(104)
  dueOffsetWeeks?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: AI_MAX_QUESTIONS })
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(AI_MAX_QUESTIONS)
  questionCount?: number | null;
  /** Assignment group name, matched (case-insensitive) or created. Empty: none. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) group?: string;
  @ApiPropertyOptional({ enum: AI_SUBMISSION_TYPES, nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(AI_SUBMISSION_TYPES)
  submission?: AiSubmissionType | null;
  /** Codes of the module's outcomes this assessment measures. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(AI_PLAN_MAX_OUTCOMES) @IsString({ each: true }) @MaxLength(64, { each: true })
  outcomes?: string[];
}

export class PlanOutcomeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) title!: string;
}

export class PlanModuleDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) overview?: string;
  /** Add the items to this existing module of the course instead of creating one ("Add selected"). */
  @ApiPropertyOptional() @IsOptional() @IsUUID() existingModuleId?: string;
  @ApiProperty({ type: [PlanItemDto] })
  @IsArray() @ArrayMaxSize(AI_PLAN_MAX_ITEMS) @ValidateNested({ each: true }) @Type(() => PlanItemDto)
  items!: PlanItemDto[];
  @ApiPropertyOptional({ type: [PlanOutcomeDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(AI_PLAN_MAX_OUTCOMES) @ValidateNested({ each: true }) @Type(() => PlanOutcomeDto)
  outcomes?: PlanOutcomeDto[];
}

/** "Create selected": the reviewed plan. Everything is created unpublished. */
export class CreatePlanDto {
  @ApiProperty({ type: [PlanModuleDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(AI_PLAN_MAX_MODULES) @ValidateNested({ each: true }) @Type(() => PlanModuleDto)
  modules!: PlanModuleDto[];
  /** Due dates count from here (YYYY-MM-DD); default the course's term, else academic year, start. None: no due dates. */
  @ApiPropertyOptional({ example: '2027-01-11' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;
  /** Create the module outcomes as course outcomes and align them (mastery on only). Default true. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() createOutcomes?: boolean;
  /** Also create an unpublished overview page at the top of each new module. Default false. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() overviewPages?: boolean;
  /**
   * The teacher wants questions drafted for the quizzes. Questions are never
   * added without acceptance: quizzes are created empty and listed so the
   * teacher drafts them in the quiz builder ("Draft questions with AI").
   */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() draftQuestions?: boolean;
}

export class ModuleItemsDraftDto {
  /** What the teacher wants in the module. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) brief?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: AI_PLAN_MAX_ITEMS })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(AI_PLAN_MAX_ITEMS) count?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) level?: string;
}

export class PageContentDraftDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  /** The teacher's outline or the page's current text to build on. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(AI_MAX_PAGE_CHARS) outline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) level?: string;
}

export class AssignmentDraftDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  /** What the teacher has in mind, or the current instructions to improve. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) brief?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) level?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) points?: number;
}

export class RubricDraftDto {
  /** The assignment's title. */
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) instructions?: string;
  /** The criteria should add up to this. */
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1000) totalPoints?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) criteria?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) level?: string;
}

export class AnnouncementDraftDto {
  /** What the announcement is about. */
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(2000) prompt!: string;
}

export class OutcomeSuggestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) brief?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) count?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) level?: string;
}
