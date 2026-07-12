import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RedisPubSubService } from '@/realtime/redis-pubsub.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';
import { ChatEventType } from './chat.constants';
import type { ChatEvent } from './chat.types';

// Drive ChatRealtimeService over a real (in-process) pub/sub bus so the
// user-channel mapping and fan-out are exercised end to end without Redis.
describe('ChatRealtimeService (over in-process bus)', () => {
  let realtime: ChatRealtimeService;
  let savedUseRedis: string | undefined;

  beforeEach(() => {
    savedUseRedis = process.env.USE_REDIS;
    process.env.USE_REDIS = 'false';
    const bus = new RedisPubSubService();
    bus.onModuleInit();
    realtime = new ChatRealtimeService(bus);
  });

  afterEach(() => {
    if (savedUseRedis === undefined) delete process.env.USE_REDIS;
    else process.env.USE_REDIS = savedUseRedis;
  });

  test('delivers an event to a subscribed user', async () => {
    const received: ChatEvent[] = [];
    await realtime.subscribeUser('u1', (e) => received.push(e));

    await realtime.publishToUsers(['u1'], {
      type: ChatEventType.Message,
      data: { hello: 'world' },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(ChatEventType.Message);
    expect(received[0].data).toEqual({ hello: 'world' });
  });

  test('does not deliver to a user who is not a target', async () => {
    const received: ChatEvent[] = [];
    await realtime.subscribeUser('u1', (e) => received.push(e));

    await realtime.publishToUsers(['u2'], {
      type: ChatEventType.Message,
      data: {},
    });

    expect(received).toHaveLength(0);
  });

  test('fans a single publish out to multiple users, deduped', async () => {
    const a: ChatEvent[] = [];
    const b: ChatEvent[] = [];
    await realtime.subscribeUser('a', (e) => a.push(e));
    await realtime.subscribeUser('b', (e) => b.push(e));

    await realtime.publishToUsers(['a', 'b', 'a'], {
      type: ChatEventType.Conversation,
      data: { id: 'c1' },
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('ChatService.directKey', () => {
  test('is stable regardless of argument order', () => {
    expect(ChatService.directKey('a', 'b')).toBe(
      ChatService.directKey('b', 'a'),
    );
  });

  test('sorts the two ids ascending', () => {
    expect(ChatService.directKey('zzz', 'aaa')).toBe('aaa:zzz');
  });
});
