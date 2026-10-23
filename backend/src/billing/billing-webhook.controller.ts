import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { billingReturnUrl, loadBillingConfig } from './billing.config';
import { BillingEnabledGuard } from './billing.guards';
import { BillingEventsService } from './billing-events.service';
import { BillingRegistry } from './billing.registry';
import type { RawBodyRequest } from './raw-body';
import {
  WebhookVerificationError,
  type BillingEvent,
  type WebhookRequest,
} from './providers/payment-provider';

type WebhookReq = FastifyRequest & RawBodyRequest;

function flatten(source: unknown): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!source || typeof source !== 'object') return out;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out[key] = Array.isArray(value)
      ? value.map(String).join(',')
      : String(value);
  }
  return out;
}

/**
 * Provider webhooks (POST) and hosted-page returns (GET). Public: trust comes
 * from each provider verifying its signature over the exact raw body.
 * Verification failures answer 400; any other failure answers 500 so the
 * provider retries; applied events are idempotent.
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

  private async receive(providerId: string, req: WebhookReq): Promise<BillingEvent[]> {
    const provider = this.registry.find(providerId);
    if (!provider || !provider.isConfigured()) throw new NotFoundException();

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
      this.logger.error(`${providerId} webhook apply failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Webhook processing failed');
    }
    return events;
  }

  @Post(':providerId')
  @HttpCode(200)
  async post(@Param('providerId') providerId: string, @Req() req: WebhookReq) {
    await this.receive(providerId, req);
    return { received: true };
  }

  /** A browser coming back from a hosted payment page: apply it, then go to the app. */
  @Get(':providerId')
  async get(
    @Param('providerId') providerId: string,
    @Req() req: WebhookReq,
    @Res() reply: FastifyReply,
  ) {
    const cfg = loadBillingConfig();
    let paid = false;
    try {
      const events = await this.receive(providerId, req);
      paid = events.some((e) => e.type === 'invoice.paid');
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
    }
    return reply.redirect(billingReturnUrl(cfg, paid ? 'success' : 'cancel'), 302);
  }
}
