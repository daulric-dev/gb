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
  Group = 'group',
}

export class ShareTargetDto {
  @IsEnum(SharePrincipalType)
  principalType!: SharePrincipalType;

  /** A user_profile id, school_role id, or student_group id per principalType. */
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
