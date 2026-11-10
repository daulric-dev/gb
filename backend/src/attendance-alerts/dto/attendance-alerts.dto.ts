import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ?from&to (local school days, inclusive) on report reads. */
export class ReportRangeDto {
  @ApiPropertyOptional({ example: '2026-10-12' })
  @IsOptional()
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-09' })
  @IsOptional()
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;
}

/** PUT /attendance-alerts/settings */
export class AlertSettingsDto {
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 100, description: 'Alert below this percent; null turns the check off.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  minRate?: number | null;

  @ApiPropertyOptional({ minimum: 7, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(120)
  windowDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  minSessions?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 2, maximum: 30 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(2)
  @Max(30)
  consecutiveAbsences?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyTutor?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyAdmins?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyParents?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailStaff?: boolean;
}

/** PUT /attendance-alerts/form-tutors */
export class FormTutorDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  studentIds!: string[];

  @ApiProperty({ nullable: true, description: 'A staff member of the school, or null to clear.' })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  tutorId!: string | null;
}

/** ?status on GET /attendance-alerts */
export class AlertListDto {
  @ApiPropertyOptional({ enum: ['open', 'resolved', 'all'] })
  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  status?: 'open' | 'resolved' | 'all';
}
