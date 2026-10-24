import {
  IsBoolean,
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
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '../attendance.types';

export class SessionLocationDto {
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;

  @ApiPropertyOptional({ default: 100, minimum: 10, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  radiusM?: number;
}

export class OpenAttendanceDto {
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationMinutes?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requireCode?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateAfterMinutes?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional({ type: SessionLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionLocationDto)
  location?: SessionLocationDto | null;
}

export class SetAttendanceRecordDto {
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  status!: AttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CheckInLocationDto {
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;

  @ApiPropertyOptional({ description: 'Reported accuracy in metres' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number | null;
}

export class CheckInDto {
  @ApiPropertyOptional({ example: '4821' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code?: string;

  /** Token from a scanned QR frame; accepted instead of the code. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  qrToken?: string;

  /** From POST /attendance/scan-claim, when the student signed in after scanning. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  qrClaim?: string;

  @ApiPropertyOptional({ type: CheckInLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckInLocationDto)
  location?: CheckInLocationDto | null;
}

export class ScanClaimDto {
  @ApiProperty() @IsUUID() sessionId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64) qrToken!: string;
}
