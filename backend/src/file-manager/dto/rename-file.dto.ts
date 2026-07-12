import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RenameFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
