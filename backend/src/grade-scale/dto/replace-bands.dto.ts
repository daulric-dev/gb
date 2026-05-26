import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { BandInputDto } from './band-input.dto';

export class ReplaceBandsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BandInputDto)
  bands!: BandInputDto[];
}
