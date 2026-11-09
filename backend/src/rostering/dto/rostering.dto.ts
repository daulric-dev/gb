import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ROSTER_ENTITIES } from '../roster-types';
import { ROSTER_MAX_UPLOADS, ROSTER_UPLOAD_MAX_BYTES } from '../rostering.constants';

export class MatchByDto {
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() studentNumber?: boolean;
}

export class RosterSettingsDto {
  /** OneRoster org sourcedId -> GradeBook school id, or null to ignore that org. */
  @IsOptional() @IsObject() orgMap?: Record<string, string | null>;
  @IsOptional() @ValidateNested() @Type(() => MatchByDto) matchBy?: MatchByDto;
  @IsOptional() @IsBoolean() notifyStudents?: boolean;
  @IsOptional() @IsBoolean() sendStaffInvites?: boolean;
  @IsOptional() @IsString() @MaxLength(500) scope?: string | null;
}

export class CreateRosterSourceDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsIn(['csv', 'oneroster_api']) kind!: 'csv' | 'oneroster_api';
  @IsOptional() @IsString() @MaxLength(2000) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) tokenUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) clientId?: string;
  @IsOptional() @IsString() @MaxLength(2000) clientSecret?: string;
  @IsOptional() @IsIn(['off', 'daily']) schedule?: 'off' | 'daily';
  @IsOptional() @IsBoolean() autoApply?: boolean;
  @IsOptional() @ValidateNested() @Type(() => RosterSettingsDto) settings?: RosterSettingsDto;
}

export class UpdateRosterSourceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) tokenUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) clientId?: string;
  /** Write-only: a non-empty value replaces the stored secret. */
  @IsOptional() @IsString() @MaxLength(2000) clientSecret?: string;
  @IsOptional() @IsIn(['off', 'daily']) schedule?: 'off' | 'daily';
  @IsOptional() @IsBoolean() autoApply?: boolean;
  @IsOptional() @ValidateNested() @Type(() => RosterSettingsDto) settings?: RosterSettingsDto;
}

export class TestConnectionDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) baseUrl!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) tokenUrl!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) clientId!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) clientSecret!: string;
  @IsOptional() @IsString() @MaxLength(500) scope?: string;
}

export class RosterUploadTicketDto {
  @IsString() @IsNotEmpty() @MaxLength(200) filename!: string;
  @IsIn(['text/csv', 'application/zip', 'application/x-zip-compressed', 'application/vnd.ms-excel', 'application/octet-stream'])
  contentType!: string;
  @IsInt() @Min(1) @Max(ROSTER_UPLOAD_MAX_BYTES) size!: number;
}

export class StartDryRunDto {
  /** Upload keys from POST .../uploads (CSV sources). */
  @IsOptional() @IsArray() @ArrayMaxSize(ROSTER_MAX_UPLOADS) @IsString({ each: true }) @Matches(/^rostering\/uploads\//, { each: true })
  uploads?: string[];
}

export class ApplyRunDto {
  /** Also apply the disables (records gone from the source). Off: they are skipped. */
  @IsOptional() @IsBoolean() includeDisables?: boolean;
}

export class ListChangesQueryDto {
  @IsOptional() @IsIn([...ROSTER_ENTITIES]) entity?: string;
  @IsOptional() @IsIn(['create', 'update', 'disable', 'error']) action?: string;
  @IsOptional() @IsIn(['pending', 'applied', 'failed', 'skipped']) status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @IsInt() @Min(0) offset?: number;
}

export class RunIdParam {
  @IsUUID() runId!: string;
}
