import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisPubSubService } from './redis-pubsub.service';
import { redisConnectionOptions, redisEnabled } from './redis.util';

export interface PresenceEvent {
  type: 'presence';
  data: { userId: string; online: boolean; at: number };
}

type PresenceHandler = (event: PresenceEvent) => void;

const TTL_SECONDS = 60;
const STALE_MS = TTL_SECONDS * 1000;

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly useRedis = redisEnabled();
  private redis?: Redis;

  // In-process fallback state (single replica).
  private readonly localCounts = new Map<string, number>();
  private readonly localSchools = new Map<string, Set<string>>();

  constructor(private readonly bus: RedisPubSubService) {}

  onModuleInit(): void {
    if (this.useRedis) {
      this.redis = new Redis(redisConnectionOptions());
      this.redis.on('error', (err) =>
        this.logger.error(`presence redis error: ${err.message}`),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  /** Mark a new SSE connection for a user. Publishes on the first connection. */
  async connect(userId: string, schoolId: string): Promise<void> {
    const now = Date.now();
    if (this.redis) {
      const count = await this.redis.incr(this.countKey(userId));
      await this.redis.expire(this.countKey(userId), TTL_SECONDS);
      await this.redis.zadd(this.schoolKey(schoolId), now, userId);
      if (count === 1) await this.publish(schoolId, userId, true, now);
      return;
    }
    const count = (this.localCounts.get(userId) ?? 0) + 1;
    this.localCounts.set(userId, count);
    this.localMembers(schoolId).add(userId);
    if (count === 1) await this.publish(schoolId, userId, true, now);
  }

  /** Keep a user's presence fresh (called on each SSE heartbeat). */
  async heartbeat(userId: string, schoolId: string): Promise<void> {
    if (this.redis) {
      await this.redis.expire(this.countKey(userId), TTL_SECONDS);
      await this.redis.zadd(this.schoolKey(schoolId), Date.now(), userId);
    }
    // In-process presence needs no refresh: it only ends on disconnect.
  }

  /** Drop one connection. Publishes offline when it was the user's last. */
  async disconnect(userId: string, schoolId: string): Promise<void> {
    const now = Date.now();
    if (this.redis) {
      const count = await this.redis.decr(this.countKey(userId));
      if (count <= 0) {
        await this.redis.del(this.countKey(userId));
        await this.redis.zrem(this.schoolKey(schoolId), userId);
        await this.publish(schoolId, userId, false, now);
      }
      return;
    }
    const count = (this.localCounts.get(userId) ?? 1) - 1;
    if (count <= 0) {
      this.localCounts.delete(userId);
      const members = this.localMembers(schoolId);
      members.delete(userId);
      // Drop the now-empty school bucket so localSchools can't accrete empty
      // Sets for schools that no longer have anyone connected.
      if (members.size === 0) this.localSchools.delete(schoolId);
      await this.publish(schoolId, userId, false, now);
    } else {
      this.localCounts.set(userId, count);
    }
  }

  /** The user ids currently online in a school (stale entries pruned). */
  async onlineUserIds(schoolId: string): Promise<string[]> {
    if (this.redis) {
      const cutoff = Date.now() - STALE_MS;
      await this.redis.zremrangebyscore(this.schoolKey(schoolId), 0, cutoff);
      return this.redis.zrange(this.schoolKey(schoolId), 0, -1);
    }
    return [...this.localMembers(schoolId)];
  }

  /** Subscribe an SSE stream to its school's presence changes. */
  async subscribeSchool(
    schoolId: string,
    handler: PresenceHandler,
  ): Promise<() => void> {
    return this.bus.subscribe(this.schoolChannel(schoolId), (payload) =>
      handler(payload as PresenceEvent),
    );
  }

  private async publish(
    schoolId: string,
    userId: string,
    online: boolean,
    at: number,
  ): Promise<void> {
    const event: PresenceEvent = {
      type: 'presence',
      data: { userId, online, at },
    };
    await this.bus.publish(this.schoolChannel(schoolId), event);
  }

  private localMembers(schoolId: string): Set<string> {
    let set = this.localSchools.get(schoolId);
    if (!set) {
      set = new Set();
      this.localSchools.set(schoolId, set);
    }
    return set;
  }

  private countKey(userId: string): string {
    return `presence:count:${userId}`;
  }
  private schoolKey(schoolId: string): string {
    return `presence:online:${schoolId}`;
  }
  private schoolChannel(schoolId: string): string {
    return `presence:school:${schoolId}`;
  }
}
