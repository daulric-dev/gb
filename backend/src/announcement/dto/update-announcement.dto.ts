import {
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateAnnouncementDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string | null;
}
