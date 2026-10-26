import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { BillingEnabledGuard } from '../access/billing.guards';
import { BillingEventsService, EventInProgressError } from './billing-events.service';
import { BillingRegistry } from '../providers/billing.registry';
import type { RawBodyRequest } from './raw-body';
import {
  WebhookVerificationError,
  type BillingEvent,
  type WebhookRequest,
} from '../providers/payment-provider';

type WebhookReq = FastifyRequest & RawBodyRequest;

function scalar(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return `${v}`;
  return JSON.stringify(v);
}

function flatten(source: unknown): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!source || typeof source !== 'object') return out;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out[key] = Array.isArray(value) ? value.map(scalar).join(',') : scalar(value);
  }
  return out;
}

/**
 * Provider webhooks (server-to-server POSTs, e.g. Stripe's). Public: trust
 * comes from the provider verifying its signature over the exact raw body.
 * Verification failures answer 400; an event another worker is applying
 * right now answers 409, and any other failure 500, so the provider retries;
 * applied events are idempotent.
 */
@ApiExcludeController()
@SkipThrottle()
@UseGuards(BillingEnabledGuard)
@Controller('billing/webhooks')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(
    private readonly registry: BillingRegistry,
    private readonly events: BillingEventsService,
  ) {}

  @Post(':providerId')
  @HttpCode(200)
  async post(@Param('providerId') providerId: string, @Req() req: WebhookReq) {
    const provider = this.registry.getEnabled(providerId);
    if (!provider) throw new NotFoundException();

    const request: WebhookRequest = {
      rawBody: req.rawBody ?? Buffer.alloc(0),
      headers: flatten(req.headers),
      query: flatten(req.query),
    };

    let events: BillingEvent[];
    try {
      events = await provider.parseWebhook(request);
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        this.logger.warn(`${providerId} webhook rejected: ${err.message}`);
        throw new BadRequestException('Webhook verification failed');
      }
      this.logger.error(`${providerId} webhook parse failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Webhook processing failed');
    }

    try {
      await this.events.handle(provider, events);
    } catch (err) {
      if (err instanceof EventInProgressError) {
        this.logger.warn(`${providerId} webhook: ${err.message} - asking for a retry`);
        throw new ConflictException('Event is being processed');
      }
      this.logger.error(`${providerId} webhook apply failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Webhook processing failed');
    }
    return { received: true };
  }
}
