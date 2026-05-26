import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ATTENDANCE_STATUSES } from './mark-attendance.dto';
import type { AttendanceStatus } from './mark-attendance.dto';

class BulkAttendanceEntry {
  @IsUUID()
  studentId!: string;

  @IsEnum(ATTENDANCE_STATUSES)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class BulkMarkAttendanceDto {
  @IsISO8601({ strict: true })
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkAttendanceEntry)
  entries!: BulkAttendanceEntry[];
}
