import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QuestionBankDto {
  @ApiProperty({ example: 'Fractions' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

export class BankDrawDto {
  @ApiProperty() @IsUUID() bankId!: string;

  /** How many random questions each student gets from the bank. */
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count!: number;
}

/** A draft quiz's bank draws, replaced as a whole list. */
export class SetBankDrawsDto {
  @ApiProperty({ type: [BankDrawDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BankDrawDto)
  draws!: BankDrawDto[];
}
