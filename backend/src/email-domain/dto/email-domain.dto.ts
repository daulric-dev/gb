import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const AUDIENCES = ['student', 'staff', 'any'] as const;
const STAFF_ROLES = ['teacher', 'member'] as const;

export class AddEmailDomainDto {
  @ApiProperty({ example: 'students.riverside.edu' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  domain!: string;

  @ApiProperty({ enum: AUDIENCES })
  @IsIn(AUDIENCES)
  audience!: (typeof AUDIENCES)[number];

  /** Staff only: join outright (true) or file a join request (false). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoJoin?: boolean;

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  staffRole?: (typeof STAFF_ROLES)[number];
}

export class UpdateEmailDomainDto {
  /** Adapter id from GET /auth/sso/providers; null turns SSO off. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ssoProvider?: string | null;

  /** Refuse email codes for this domain; its people must use ssoProvider. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ssoRequired?: boolean;

  /** The school's Microsoft Entra tenant, needed for Microsoft sign-in. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  azureTenantId?: string | null;

  @ApiPropertyOptional({ enum: AUDIENCES })
  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoJoin?: boolean;

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  staffRole?: (typeof STAFF_ROLES)[number];
}
