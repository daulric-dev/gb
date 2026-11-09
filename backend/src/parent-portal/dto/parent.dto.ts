import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const RELATIONSHIPS = ['mother', 'father', 'guardian'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const NOTICE_KINDS = [
  'missing_work',
  'absence',
  'new_grade',
  'announcement',
  'attendance_alert',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

class RelationshipFields {
  @ApiPropertyOptional({ enum: RELATIONSHIPS })
  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: Relationship;

  @ApiPropertyOptional({ example: 'Grandmother', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationshipLabel?: string;
}

/** POST /students/:studentId/parents/invites */
export class InviteParentDto extends RelationshipFields {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

/** POST /students/:studentId/parents/link-codes */
export class CreateLinkCodeDto extends RelationshipFields {}

class NameFields {
  @ApiPropertyOptional({ description: 'Needed when the account has no name yet.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}

/** POST /parent/link/accept */
export class AcceptParentInviteDto extends NameFields {
  @ApiProperty({ description: 'The token from the invitation link.' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

/** POST /parent/link/redeem */
export class RedeemLinkCodeDto extends NameFields {
  @ApiProperty({ example: 'ABCDE-FGHJK' })
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  code!: string;
}

/** PUT /parent/notifications/preferences */
export class ParentNotificationPrefsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({ enum: NOTICE_KINDS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTICE_KINDS.length)
  @IsIn(NOTICE_KINDS, { each: true })
  kinds?: NoticeKind[];
}

/** PATCH /schools/current/parent-settings */
export class UpdateParentSettingsDto {
  @ApiProperty({
    example: { showGrades: false, maxStudentAge: 18 },
    description:
      'Any of showGrades, showWork, showAttendance, showAnnouncements, showReports (booleans) and maxStudentAge (null or 10-30). Unknown keys are a 400.',
  })
  @IsObject()
  settings!: Record<string, unknown>;
}
