import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisConnectionOptions, redisEnabled } from './redis.util';

export type PubSubHandler = (payload: unknown) => void;

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name);
  private readonly useRedis = redisEnabled();

  private publisher?: Redis;
  private subscriber?: Redis;

  /** channel -> set of local handlers subscribed to it. */
  private readonly handlers = new Map<string, Set<PubSubHandler>>();

  onModuleInit(): void {
    if (!this.useRedis) {
      this.logger.log('Redis disabled — pub/sub bus running in-process only');
      return;
    }

    const opts = redisConnectionOptions();
    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);

    this.subscriber.on('message', (channel: string, payload: string) => {
      this.deliver(channel, this.parse(payload));
    });
    this.subscriber.on('error', (err) =>
      this.logger.error(`pub/sub subscriber error: ${err.message}`),
    );
    this.publisher.on('error', (err) =>
      this.logger.error(`pub/sub publisher error: ${err.message}`),
    );

    this.logger.log('Realtime pub/sub using Redis');
  }

  async onModuleDestroy(): Promise<void> {
    this.handlers.clear();
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  /** Publish a JSON-serializable payload to a channel. */
  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.publisher) {
      try {
        await this.publisher.publish(channel, JSON.stringify(payload));
      } catch (err) {
        this.logger.error(
          `publish to ${channel} failed: ${(err as Error).message}`,
        );
      }
      return;
    }
    // In-process: deliver straight to local handlers.
    this.deliver(channel, payload);
  }

  async subscribe(
    channel: string,
    handler: PubSubHandler,
  ): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      if (this.subscriber) {
        try {
          await this.subscriber.subscribe(channel);
        } catch (err) {
          this.logger.error(
            `subscribe to ${channel} failed: ${(err as Error).message}`,
          );
        }
      }
    }
    set.add(handler);
    return () => this.unsubscribe(channel, handler);
  }

  private unsubscribe(channel: string, handler: PubSubHandler): void {
    const set = this.handlers.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(channel);
      // Fire-and-forget: a failed unsubscribe only leaks a dead subscription.
      this.subscriber?.unsubscribe(channel).catch(() => undefined);
    }
  }

  private deliver(channel: string, payload: unknown): void {
    const set = this.handlers.get(channel);
    if (!set || set.size === 0 || payload === undefined) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        this.logger.error(
          `pub/sub handler for ${channel} failed: ${(err as Error).message}`,
        );
      }
    }
  }

  private parse(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch {
      this.logger.warn('dropped malformed pub/sub payload');
      return undefined;
    }
  }
}
