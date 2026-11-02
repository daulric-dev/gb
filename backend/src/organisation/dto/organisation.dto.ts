import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const SCHOOL_TYPES = [
  'preschool',
  'primary',
  'middle',
  'secondary',
  'all_through',
  'sixth_form',
  'college',
  'university',
  'vocational',
  'special_education',
  'online',
  'other',
] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];

/** POST /setup: name the organisation. */
export class SetupDto {
  @ApiProperty({ example: 'Riverside Education Trust' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organisationName!: string;
}

/** PATCH /organisation. */
export class UpdateOrganisationDto {
  @ApiProperty({ example: 'Riverside Education Trust' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;
}

/** POST /organisation/admins, PUT /organisation/schools/:id/admin. */
export class AdminEmailDto {
  @ApiProperty({ example: 'head@example.org' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

/** POST /organisation/schools. */
export class CreateOrganisationSchoolDto {
  @ApiProperty({ example: 'Riverside Primary' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'RVP' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ example: 'primary', enum: SCHOOL_TYPES })
  @IsOptional()
  @IsIn(SCHOOL_TYPES)
  schoolType?: SchoolType;

  @ApiPropertyOptional({ example: 'head@example.org' })
  @Transform(trim)
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  adminEmail?: string;
}

/** PATCH /organisation/schools/:id. */
export class UpdateOrganisationSchoolDto {
  @ApiPropertyOptional({ example: 'Riverside Primary' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'RVP', nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string | null;

  @ApiPropertyOptional({ example: 'secondary', enum: SCHOOL_TYPES })
  @IsOptional()
  @IsIn(SCHOOL_TYPES)
  schoolType?: SchoolType;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
