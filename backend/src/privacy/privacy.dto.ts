import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { LAWFUL_BASIS_KEYS, PURPOSE_KEYS } from './privacy.catalog';

/** `{ purposeKey: basisKey[] }`: known purposes and bases only, 1-4 bases each (empty = the default). */
@ValidatorConstraint({ name: 'lawfulBases' })
export class LawfulBasesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value as Record<string, unknown>).every(
      ([purpose, bases]) =>
        PURPOSE_KEYS.includes(purpose) &&
        Array.isArray(bases) &&
        bases.length <= 4 &&
        bases.every((b) => typeof b === 'string' && (LAWFUL_BASIS_KEYS as string[]).includes(b)),
    );
  }

  defaultMessage(): string {
    return `lawfulBases maps a purpose (${PURPOSE_KEYS.join(', ')}) to up to 4 of: ${LAWFUL_BASIS_KEYS.join(', ')}`;
  }
}

export class AdditionalRecipientDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsString() @MinLength(1) @MaxLength(500) purpose!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) location?: string | null;
}

/** Text fields: omit to keep, null or "" to clear. */
export class UpdatePrivacySettingsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(200)
  controllerName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(500)
  controllerAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() @MaxLength(254)
  privacyEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(200)
  dpoName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() @MaxLength(254)
  dpoEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(200)
  supervisoryAuthorityName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(500)
  supervisoryAuthorityUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MaxLength(200)
  dataLocation?: string | null;

  @ApiPropertyOptional({ description: '{ purposeKey: basisKey[] }; an empty list restores the default' })
  @IsOptional() @IsObject() @Validate(LawfulBasesConstraint)
  lawfulBases?: Record<string, string[]>;

  @ApiPropertyOptional({ type: [AdditionalRecipientDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AdditionalRecipientDto)
  additionalRecipients?: AdditionalRecipientDto[];
}
