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
  /** channel -> the Redis SUBSCRIBE for it (in flight or done). */
  private readonly subscriptions = new Map<string, Promise<void>>();
  private destroyed = false;

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
    this.destroyed = true;
    this.handlers.clear();
    this.subscriptions.clear();
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  async checkHealth(): Promise<'up' | 'disabled'> {
    if (!this.useRedis) return 'disabled';
    if (!this.publisher) throw new Error('Redis publisher is not initialized');
    await this.publisher.ping();
    return 'up';
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

  /**
   * Register a handler. The handler joins the channel's set before any await,
   * so a concurrent unsubscribe of another handler can never see the set
   * empty and tear the channel down under a subscribe still in flight. Every
   * caller (not just the first) waits for the channel's Redis SUBSCRIBE.
   */
  async subscribe(
    channel: string,
    handler: PubSubHandler,
  ): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    const unsubscribe = () => this.unsubscribe(channel, handler);
    if (!this.subscriber) return unsubscribe;

    await this.redisSubscribe(channel);
    // The set we joined is no longer the channel's (it was torn down while
    // we waited): re-register rather than hand back an orphaned handler.
    if (this.handlers.get(channel) !== set && !this.destroyed) {
      return this.subscribe(channel, handler);
    }
    return unsubscribe;
  }

  /** One SUBSCRIBE per channel; a failed one is forgotten so the next retries. */
  private redisSubscribe(channel: string): Promise<void> {
    const existing = this.subscriptions.get(channel);
    if (existing) return existing;
    const pending: Promise<void> = this.subscriber!.subscribe(channel).then(
      () => undefined,
      (err: Error) => {
        this.logger.error(`subscribe to ${channel} failed: ${err.message}`);
        if (this.subscriptions.get(channel) === pending) {
          this.subscriptions.delete(channel);
        }
      },
    );
    this.subscriptions.set(channel, pending);
    return pending;
  }

  private unsubscribe(channel: string, handler: PubSubHandler): void {
    const set = this.handlers.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(channel);
      this.subscriptions.delete(channel);
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
