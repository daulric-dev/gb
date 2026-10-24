import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export enum SharePrincipalType {
  User = 'user',
  Role = 'role',
  /** Everyone on a course: its staff and its actively enrolled students. */
  Course = 'course',
}

export class ShareTargetDto {
  @IsEnum(SharePrincipalType)
  principalType!: SharePrincipalType;

  /** A user_profile id, school_role id, or course id per principalType. */
  @IsUUID()
  principalId!: string;

  /** When true the recipient may also download; otherwise view-only. */
  @IsOptional()
  @IsBoolean()
  canDownload?: boolean;
}

export class ShareFileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShareTargetDto)
  shares!: ShareTargetDto[];
}
