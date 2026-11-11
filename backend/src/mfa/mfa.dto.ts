import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** POST /auth/mfa/verify: finish a sign-in that answered 403 MFA_REQUIRED. */
export class VerifyMfaDto {
  @ApiProperty({ description: 'The `mfaToken` from the 403 MFA_REQUIRED answer (5 minutes, single use)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @ApiPropertyOptional({ example: '123456', description: '6-digit code from the authenticator app' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  code?: string;

  @ApiPropertyOptional({ example: 'abcde-fghjk', description: 'One unused recovery code, instead of `code`' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}

/** POST /auth/mfa/enrol/confirm. */
export class ConfirmMfaDto {
  @ApiProperty({ example: '123456', description: 'A current code from the app being set up' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code!: string;
}

/** POST /auth/mfa/disable: a current code or an unused recovery code. */
export class DisableMfaDto {
  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  code?: string;

  @ApiPropertyOptional({ example: 'abcde-fghjk' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recoveryCode?: string;
}

/** PATCH /organisation/mfa-policy. */
export class MfaPolicyDto {
  @ApiProperty({ description: 'Require an authenticator app for administrators and safeguarding roles' })
  @IsBoolean()
  requireMfaForAdmins!: boolean;
}
