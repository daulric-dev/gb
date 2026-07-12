import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { userChannel } from './chat.constants';
import type { ChatEvent } from './chat.types';

type Handler = (event: ChatEvent) => void;

/**
 * The chat fan-out bus. Publishing an event sends it to every replica; each
 * replica dispatches it only to the SSE handlers it holds for that channel.
 *
 * - **Redis enabled** (prod, 3 stateless replicas): one shared publisher and
 *   one shared subscriber connection. A replica subscribes to a channel while
 *   it has at least one local handler for it, and unsubscribes when the last
 *   one disconnects — so a user's events reach whichever replica their SSE
 *   stream landed on, with no sticky sessions.
 * - **Redis disabled** (single-process dev): the same API, dispatched in-memory
 *   via the handler map. Cross-replica delivery is a no-op because there is
 *   only one process.
 *
 * ioredis (already a dependency, and what BullMQ uses under Bun here) is used
 * rather than Bun's RedisClient because a subscriber connection must be
 * dedicated to pub/sub, which ioredis models explicitly.
 */
@Injectable()
export class ChatRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private readonly useRedis =
    process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;

  private publisher?: Redis;
  private subscriber?: Redis;

  /** channel -> set of local SSE handlers subscribed to it. */
  private readonly handlers = new Map<string, Set<Handler>>();

  onModuleInit(): void {
    if (!this.useRedis) {
      this.logger.log('Redis disabled — chat bus running in-process only');
      return;
    }

    const opts = this.connectionOptions();
    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);

    this.subscriber.on('message', (channel: string, payload: string) => {
      this.dispatch(channel, payload);
    });
    this.subscriber.on('error', (err) =>
      this.logger.error(`Chat subscriber error: ${err.message}`),
    );
    this.publisher.on('error', (err) =>
      this.logger.error(`Chat publisher error: ${err.message}`),
    );

    this.logger.log('Chat bus using Redis pub/sub');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.publisher?.quit(),
      this.subscriber?.quit(),
    ]);
  }

  /** Publish one event to a set of users (deduped). */
  async publishToUsers(userIds: string[], event: ChatEvent): Promise<void> {
    const unique = [...new Set(userIds)];
    await Promise.all(unique.map((id) => this.publish(userChannel(id), event)));
  }

  private async publish(channel: string, event: ChatEvent): Promise<void> {
    if (this.publisher) {
      try {
        await this.publisher.publish(channel, JSON.stringify(event));
      } catch (err) {
        this.logger.error(
          `Publish to ${channel} failed: ${(err as Error).message}`,
        );
      }
      return;
    }
    // In-process fallback: deliver directly to local handlers.
    this.dispatch(channel, JSON.stringify(event));
  }

  /**
   * Subscribe an SSE stream to a user's channel. Returns an unsubscribe
   * function the controller must call when the connection closes.
   */
  async subscribeUser(userId: string, handler: Handler): Promise<() => void> {
    const channel = userChannel(userId);
    let set = this.handlers.get(channel);

    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      if (this.subscriber) {
        try {
          await this.subscriber.subscribe(channel);
        } catch (err) {
          this.logger.error(
            `Subscribe to ${channel} failed: ${(err as Error).message}`,
          );
        }
      }
    }
    set.add(handler);

    return () => this.unsubscribe(channel, handler);
  }

  private unsubscribe(channel: string, handler: Handler): void {
    const set = this.handlers.get(channel);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(channel);
      // Fire-and-forget: an unsubscribe error only leaks a dead subscription.
      this.subscriber?.unsubscribe(channel).catch(() => undefined);
    }
  }

  private dispatch(channel: string, payload: string): void {
    const set = this.handlers.get(channel);
    if (!set || set.size === 0) return;
    let event: ChatEvent;
    try {
      event = JSON.parse(payload) as ChatEvent;
    } catch {
      this.logger.warn(`Dropped malformed bus payload on ${channel}`);
      return;
    }
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        this.logger.error(`SSE handler failed: ${(err as Error).message}`);
      }
    }
  }

  private connectionOptions() {
    const url = new URL(process.env.REDIS_URL!);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
      // A subscriber must reconnect and re-subscribe transparently.
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    };
  }
}
