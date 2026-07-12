import { Injectable } from '@nestjs/common';
import { RedisPubSubService } from '@/realtime/redis-pubsub.service';
import { userChannel } from './chat.constants';
import type { ChatEvent } from './chat.types';

/**
 * Chat's view of the realtime bus. It maps chat concepts (a user's events) onto
 * the generic {@link RedisPubSubService} pub/sub channels: every event destined
 * for a user is published to that user's channel, and each SSE connection
 * subscribes to exactly its user's channel. Fan-out is therefore O(participants)
 * and needs no sticky sessions across replicas.
 */
@Injectable()
export class ChatRealtimeService {
  constructor(private readonly bus: RedisPubSubService) {}

  /** Publish one event to each of the given users (deduped). */
  async publishToUsers(userIds: string[], event: ChatEvent): Promise<void> {
    const unique = [...new Set(userIds)];
    await Promise.all(
      unique.map((id) => this.bus.publish(userChannel(id), event)),
    );
  }

  /**
   * Subscribe an SSE stream to a user's channel. Returns an unsubscribe
   * function the controller must call when the connection closes.
   */
  async subscribeUser(
    userId: string,
    handler: (event: ChatEvent) => void,
  ): Promise<() => void> {
    return this.bus.subscribe(userChannel(userId), (payload) =>
      handler(payload as ChatEvent),
    );
  }
}
