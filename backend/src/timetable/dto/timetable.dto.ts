import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date (YYYY-MM-DD)';

/** PATCH /schools/current/timetable/settings */
export class UpdateTimetableSettingsDto {
  @ApiPropertyOptional({ example: 'Europe/London', description: 'IANA time zone of the school.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;

  @ApiPropertyOptional({ nullable: true, minimum: 2, maximum: 20, description: 'Days in a rotating cycle; null for a weekly timetable.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(2)
  @Max(20)
  cycleLength?: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-09-07', description: 'Cycle day 1. Needed with a cycle.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: `cycleStartDate ${DATE_MESSAGE}` })
  cycleStartDate?: string | null;

  @ApiPropertyOptional({ type: [Number], example: [1, 2, 3, 4, 5], description: 'ISO weekdays the school is open (1 = Monday).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  schoolDays?: number[];

  @ApiPropertyOptional({ description: 'Open and close check-in sessions automatically.' })
  @IsOptional()
  @IsBoolean()
  autoSessions?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  leadMinutes?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 240 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(240)
  lateAfterMinutes?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireCode?: boolean;
}

class RoomLocationDto {
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiPropertyOptional({ minimum: 10, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1000)
  radiusM?: number;
}

/** POST / PATCH /schools/current/timetable/rooms */
export class RoomDto {
  @ApiPropertyOptional({ example: 'Lab 2' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: RoomLocationDto, nullable: true, description: 'Saved location for check-in; null clears it.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => RoomLocationDto)
  location?: RoomLocationDto | null;
}

export class PeriodTimeDto {
  @ApiProperty({ minimum: 1, maximum: 7 }) @IsInt() @Min(1) @Max(7) weekday!: number;
  @ApiProperty({ description: 'Minutes after local midnight.' }) @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(1440) endMinute!: number;
}

/** POST / PATCH /schools/current/timetable/periods */
export class PeriodDto {
  @ApiPropertyOptional({ example: 'Period 1' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;

  @ApiPropertyOptional({ type: [PeriodTimeDto], description: 'Replaces every weekday time.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => PeriodTimeDto)
  times?: PeriodTimeDto[];
}

/** POST /schools/current/timetable/closures */
export class ClosureDto {
  @ApiProperty({ example: 'Half term' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '2026-10-26' })
  @Matches(DATE, { message: `startDate ${DATE_MESSAGE}` })
  startDate!: string;

  @ApiProperty({ example: '2026-10-30' })
  @Matches(DATE, { message: `endDate ${DATE_MESSAGE}` })
  endDate!: string;
}

/** POST / PATCH /courses/:courseId/timetable/entries */
export class TimetableEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  roomId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 7, description: 'Weekly: ISO weekday. Give this or cycleDay.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 20, description: 'Rotating: the cycle day.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(20)
  cycleDay?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: `validFrom ${DATE_MESSAGE}` })
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: `validTo ${DATE_MESSAGE}` })
  validTo?: string | null;
}

/** PUT /courses/:courseId/timetable/occurrences/:entryId/:date */
export class OccurrenceOverrideDto {
  @ApiProperty({ enum: ['cancel', 'move'] })
  @IsIn(['cancel', 'move'])
  kind!: 'cancel' | 'move';

  @ApiPropertyOptional({ description: 'Move: the new date (default the same day).' })
  @IsOptional()
  @Matches(DATE, { message: `date ${DATE_MESSAGE}` })
  date?: string;

  @ApiPropertyOptional({ description: 'Move: new start, minutes after local midnight.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  roomId?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** ?from&to on timetable reads. */
export class RangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE, { message: `from ${DATE_MESSAGE}` }) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE, { message: `to ${DATE_MESSAGE}` }) to?: string;
}
