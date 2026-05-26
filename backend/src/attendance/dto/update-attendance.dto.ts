import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ATTENDANCE_STATUSES } from './mark-attendance.dto';
import type { AttendanceStatus } from './mark-attendance.dto';

export class UpdateAttendanceDto {
  @IsOptional()
  @IsEnum(ATTENDANCE_STATUSES)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
