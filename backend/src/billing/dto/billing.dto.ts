import {
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

  /** Defaults to the configured provider (Stripe). */
  @ApiPropertyOptional({ example: 'stripe' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;
}

export class ChangePlanDto {
  @ApiProperty({ enum: PLANS })
  @IsIn(PLANS)
  plan!: BillingPlan;
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

export const INVOICE_STATUSES = ['open', 'paid', 'void', 'uncollectible'];
