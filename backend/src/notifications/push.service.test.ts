import { describe, expect, test } from 'bun:test';
import { EXPO_PUSH_URL, PushService } from './push.service';
import { createMockPrisma } from '@/test/prisma-mock';

/** Every school has push notifications on. */
const featuresOn = { isEnabled: async () => true };

const token = (i: number) => `ExponentPushToken[tok-${i}]`;

function setup(tokens: string[], respond?: (messages: any[]) => any) {
  const prisma = createMockPrisma();
  prisma.push_device.findMany.mockResolvedValue(tokens.map((t) => ({ token: t })));
  const service = new PushService(prisma as any, featuresOn as any);
  const requests: { url: string; init: RequestInit; messages: any[] }[] = [];
  service.fetchImpl = async (url, init) => {
    const messages = JSON.parse(String(init.body));
    requests.push({ url, init, messages });
    const body = respond?.(messages) ?? {
      data: messages.map(() => ({ status: 'ok', id: 'x' })),
    };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { service, prisma, requests };
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
    const { service, prisma } = setup([token(1), token(2), token(3)], (messages) => ({
      data: messages.map((m: any) =>
        m.to === token(2)
          ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
          : m.to === token(3)
            ? { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }
            : { status: 'ok', id: 'a' },
      ),
    }));

    await service.sendToUsers(['u-1'], { title: 't', body: 'b' });

    const deletes = prisma.push_device.deleteMany.mock.calls;
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0].where).toEqual({ token: { in: [token(2)] } });
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
    const prisma = createMockPrisma();
    await new PushService(prisma as any, featuresOn as any).register('u-2', ' ExpoPushToken[a] ', 'ios');
    const [args] = prisma.push_device.upsert.mock.calls[0];
    expect(args.where).toEqual({ token: 'ExpoPushToken[a]' });
    expect(args.create).toMatchObject({ user_id: 'u-2', token: 'ExpoPushToken[a]', platform: 'ios' });
    expect(args.update).toMatchObject({ user_id: 'u-2', platform: 'ios' });
  });

  test('unregister only touches the caller’s own token', async () => {
    const prisma = createMockPrisma();
    await new PushService(prisma as any, featuresOn as any).unregister('u-2', 'ExpoPushToken[a]');
    const [args] = prisma.push_device.deleteMany.mock.calls[0];
    expect(args.where).toEqual({ user_id: 'u-2', token: 'ExpoPushToken[a]' });
  });
});

describe('PushService and the push_notifications feature', () => {
  test('skips recipients whose school has push notifications off', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findMany.mockResolvedValue([
      { id: 'u-on', school_id: 's-on' },
      { id: 'u-off', school_id: 's-off' },
    ]);
    prisma.push_device.findMany.mockResolvedValue([{ token: token(1) }]);
    const checked: (string | null)[] = [];
    const features = {
      isEnabled: async (school: string | null, key: string) => {
        expect(key).toBe('push_notifications');
        checked.push(school);
        return school === 's-on';
      },
    };
    const service = new PushService(prisma as any, features as any);
    let sent = 0;
    service.fetchImpl = async (_url, init) => {
      sent += JSON.parse(String(init.body)).length;
      return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 });
    };

    await service.sendToUsers(['u-on', 'u-off'], { title: 't', body: 'b' });

    expect(checked.sort()).toEqual(['s-off', 's-on']);
    expect(prisma.push_device.findMany.mock.calls[0][0].where.user_id.in).toEqual(['u-on']);
    expect(sent).toBe(1);
  });

  test('sends nothing when it is off everywhere', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findMany.mockResolvedValue([{ id: 'u-1', school_id: 's-1' }]);
    const service = new PushService(prisma as any, { isEnabled: async () => false } as any);
    let calls = 0;
    service.fetchImpl = async () => {
      calls++;
      return new Response('{}', { status: 200 });
    };
    await service.sendToUsers(['u-1'], { title: 't', body: 'b' });
    expect(prisma.push_device.findMany).not.toHaveBeenCalled();
    expect(calls).toBe(0);
  });
});
