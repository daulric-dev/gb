import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSchoolDto {
  @ApiProperty({ example: 'St. Andrew Anglican Secondary' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'SAS001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'secondary', enum: ['primary', 'secondary'] })
  @IsEnum(['primary', 'secondary'])
  @IsNotEmpty()
  schoolType: 'primary' | 'secondary';

  @ApiProperty({ example: 'St. Andrew' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  parish: string;

  @ApiPropertyOptional({ example: '123 Main Street' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: 'school@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '473-555-0100' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}