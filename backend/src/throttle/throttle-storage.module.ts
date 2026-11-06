import { Module } from '@nestjs/common';
import { createThrottlerStorage } from './redis-throttler.storage';

/** Injection token: a `RedisThrottlerStorage`, or `undefined` without Redis. */
export const THROTTLER_SHARED_STORAGE = Symbol('THROTTLER_SHARED_STORAGE');

/**
 * Owns the rate limiter's Redis connection, so Nest runs the storage's
 * `onModuleDestroy` (closing the client) on shutdown.
 */
@Module({
  providers: [
    { provide: THROTTLER_SHARED_STORAGE, useFactory: createThrottlerStorage },
  ],
  exports: [THROTTLER_SHARED_STORAGE],
})
export class ThrottleStorageModule {}
