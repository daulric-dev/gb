import { Global, Module } from '@nestjs/common';
import { RedisPubSubService } from './redis-pubsub.service';
import { PresenceService } from './presence.service';

/**
 * Global so any feature can inject the Redis pub/sub bus and presence tracker
 * for realtime fan-out without importing this module.
 */
@Global()
@Module({
  providers: [RedisPubSubService, PresenceService],
  exports: [RedisPubSubService, PresenceService],
})
export class RealtimeModule {}
