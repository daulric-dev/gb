import { describe, expect, test } from 'bun:test';
import { EXPO_PUSH_URL, PushService } from './push.service';
import { createRoutingSupabase } from '@/test/mocks';

const token = (i: number) => `ExponentPushToken[tok-${i}]`;

function setup(tokens: string[], respond?: (messages: any[]) => any) {
  const sb = createRoutingSupabase({
    tables: {
      push_device: (call) =>
        call.op === 'select'
          ? { data: tokens.map((t) => ({ token: t })), error: null }
          : { data: null, error: null },
    },
  });
  const service = new PushService(sb as any);
  const requests: { url: string; init: RequestInit; messages: any[] }[] = [];
  service.fetchImpl = async (url, init) => {
    const messages = JSON.parse(String(init.body));
    requests.push({ url, init, messages });
    const body = respond?.(messages) ?? {
      data: messages.map(() => ({ status: 'ok', id: 'x' })),
    };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { service, sb, requests };
}

describe('PushService.sendToUsers', () => {
  test('chunks into requests of 100 and skips non-Expo tokens', async () => {
    const tokens = [...Array.from({ length: 230 }, (_, i) => token(i)), 'not-a-token', 'ExpoPushToken[]'];
    const { service, requests } = setup(tokens);

    await service.sendToUsers(['u-1', 'u-2'], {
      title: 'Attendance is open',
      body: 'Biology 101: tap to check in',
      data: { type: 'attendance.opened' },
      channelId: 'attendance',
    });

    expect(requests.map((r) => r.messages.length)).toEqual([100, 100, 30]);
    expect(requests[0].url).toBe(EXPO_PUSH_URL);
    expect(requests[0].messages[0]).toMatchObject({
      to: token(0),
      title: 'Attendance is open',
      body: 'Biology 101: tap to check in',
      data: { type: 'attendance.opened' },
      channelId: 'attendance',
      sound: 'default',
      priority: 'high',
    });
    const all = requests.flatMap((r) => r.messages.map((m: any) => m.to));
    expect(all).not.toContain('not-a-token');
  });

  test('forgets tokens Expo reports as DeviceNotRegistered', async () => {
    const { service, sb } = setup([token(1), token(2), token(3)], (messages) => ({
      data: messages.map((m: any) =>
        m.to === token(2)
          ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
          : m.to === token(3)
            ? { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }
            : { status: 'ok', id: 'a' },
      ),
    }));

    await service.sendToUsers(['u-1'], { title: 't', body: 'b' });

    const deletes = sb._calls.filter((c: any) => c.table === 'push_device' && c.op === 'delete');
    expect(deletes).toHaveLength(1);
  });

  test('nothing to do without users or devices', async () => {
    const { service, requests } = setup([]);
    await service.sendToUsers([], { title: 't', body: 'b' });
    await service.sendToUsers(['u-1'], { title: 't', body: 'b' });
    expect(requests).toHaveLength(0);
  });

  test('never throws when Expo fails', async () => {
    const { service } = setup([token(1)]);
    service.fetchImpl = () => Promise.reject(new Error('network down'));
    await service.sendToUsers(['u-1'], { title: 't', body: 'b' });

    service.fetchImpl = async () => new Response('nope', { status: 500 });
    await service.sendToUsers(['u-1'], { title: 't', body: 'b' });
  });

  test('sends the access token when configured', async () => {
    const { service, requests } = setup([token(1)]);
    process.env.EXPO_ACCESS_TOKEN = 'secret';
    try {
      await service.sendToUsers(['u-1'], { title: 't', body: 'b' });
    } finally {
      delete process.env.EXPO_ACCESS_TOKEN;
    }
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret',
    );
  });
});

describe('PushService devices', () => {
  test('register upserts on token so it moves to the caller', async () => {
    const sb = createRoutingSupabase();
    await new PushService(sb as any).register('u-2', ' ExpoPushToken[a] ', 'ios');
    const call = sb._calls.find((c: any) => c.table === 'push_device')!;
    expect(call.op).toBe('upsert');
    expect(call.payload).toMatchObject({ user_id: 'u-2', token: 'ExpoPushToken[a]', platform: 'ios' });
  });

  test('unregister only touches the caller’s own token', async () => {
    const sb = createRoutingSupabase();
    await new PushService(sb as any).unregister('u-2', 'ExpoPushToken[a]');
    const call = sb._calls.find((c: any) => c.table === 'push_device')!;
    expect(call.op).toBe('delete');
    expect(call.filters).toEqual({ user_id: 'u-2', token: 'ExpoPushToken[a]' });
  });
});
