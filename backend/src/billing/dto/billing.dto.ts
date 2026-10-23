import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BillingPlan } from '../providers/payment-provider';

const PLANS = ['per_user', 'flat'];

export class CheckoutDto {
  @ApiProperty({ enum: PLANS })
  @IsIn(PLANS)
  plan!: BillingPlan;

  @ApiProperty({ example: 'manual' })
  @IsString()
  @MaxLength(40)
  provider!: string;
}

export class ChangePlanDto {
  @ApiProperty({ enum: PLANS })
  @IsIn(PLANS)
  plan!: BillingPlan;
}

export class PayInvoiceDto {
  @ApiProperty({ example: 'wipay' })
  @IsString()
  @MaxLength(40)
  provider!: string;
}

export class ExtendTrialDto {
  @ApiProperty({ minimum: 1, maximum: 365 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;
}

export class CompDto {
  @ApiProperty({ example: '2027-01-01' })
  @IsDateString()
  until!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export const MARK_PAID_METHODS = ['bank_transfer', 'cheque', 'cash', 'other'] as const;

export class MarkPaidDto {
  @ApiProperty({ enum: MARK_PAID_METHODS })
  @IsIn(MARK_PAID_METHODS)
  method!: (typeof MARK_PAID_METHODS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class VoidInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SetProviderDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export const INVOICE_STATUSES = ['open', 'paid', 'void', 'uncollectible'];
