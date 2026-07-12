import type { RedisOptions } from 'ioredis';

/** Whether Redis-backed realtime is enabled (shared bus + presence). */
export function redisEnabled(): boolean {
  return process.env.USE_REDIS === 'true' && !!process.env.REDIS_URL;
}

/** ioredis connection options parsed from REDIS_URL, shared by all clients. */
export function redisConnectionOptions(): RedisOptions {
  const url = new URL(process.env.REDIS_URL!);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    // Reconnect (and, for a subscriber, re-subscribe) transparently.
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  };
}
