import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';
import { ChatEventType } from './chat.constants';
import type { ChatEvent } from './chat.types';

// Force in-process mode so the bus dispatches locally and needs no Redis
// server, regardless of USE_REDIS in the ambient environment.
describe('ChatRealtimeService (in-process)', () => {
  let bus: ChatRealtimeService;
  let savedUseRedis: string | undefined;

  beforeEach(() => {
    savedUseRedis = process.env.USE_REDIS;
    process.env.USE_REDIS = 'false';
    bus = new ChatRealtimeService();
    bus.onModuleInit();
  });

  afterEach(() => {
    if (savedUseRedis === undefined) delete process.env.USE_REDIS;
    else process.env.USE_REDIS = savedUseRedis;
  });

  test('delivers an event to a subscribed user', async () => {
    const received: ChatEvent[] = [];
    await bus.subscribeUser('u1', (e) => received.push(e));

    await bus.publishToUsers(['u1'], {
      type: ChatEventType.Message,
      data: { hello: 'world' },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(ChatEventType.Message);
    expect(received[0].data).toEqual({ hello: 'world' });
  });

  test('does not deliver to users who are not subscribed', async () => {
    const received: ChatEvent[] = [];
    await bus.subscribeUser('u1', (e) => received.push(e));

    await bus.publishToUsers(['u2'], {
      type: ChatEventType.Message,
      data: {},
    });

    expect(received).toHaveLength(0);
  });

  test('unsubscribe stops further delivery', async () => {
    const received: ChatEvent[] = [];
    const unsub = await bus.subscribeUser('u1', (e) => received.push(e));

    unsub();
    await bus.publishToUsers(['u1'], {
      type: ChatEventType.Read,
      data: {},
    });

    expect(received).toHaveLength(0);
  });

  test('fans a single publish out to multiple users', async () => {
    const a: ChatEvent[] = [];
    const b: ChatEvent[] = [];
    await bus.subscribeUser('a', (e) => a.push(e));
    await bus.subscribeUser('b', (e) => b.push(e));

    await bus.publishToUsers(['a', 'b', 'a'], {
      type: ChatEventType.Conversation,
      data: { id: 'c1' },
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('ChatService.directKey', () => {
  test('is stable regardless of argument order', () => {
    expect(ChatService.directKey('a', 'b')).toBe(ChatService.directKey('b', 'a'));
  });

  test('sorts the two ids ascending', () => {
    expect(ChatService.directKey('zzz', 'aaa')).toBe('aaa:zzz');
  });
});
