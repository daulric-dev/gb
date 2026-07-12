import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RedisPubSubService } from './redis-pubsub.service';
import { PresenceService } from './presence.service';
import type { PresenceEvent } from './presence.service';

const SCHOOL = 's1';

// In-process mode (USE_REDIS forced off): connection counting and the online
// set live in-memory, and events flow over the in-process bus.
describe('PresenceService (in-process)', () => {
  let bus: RedisPubSubService;
  let presence: PresenceService;
  let events: PresenceEvent[];
  let savedUseRedis: string | undefined;

  beforeEach(async () => {
    savedUseRedis = process.env.USE_REDIS;
    process.env.USE_REDIS = 'false';
    bus = new RedisPubSubService();
    bus.onModuleInit();
    presence = new PresenceService(bus);
    presence.onModuleInit();

    events = [];
    await presence.subscribeSchool(SCHOOL, (e) => events.push(e));
  });

  afterEach(() => {
    if (savedUseRedis === undefined) delete process.env.USE_REDIS;
    else process.env.USE_REDIS = savedUseRedis;
  });

  test('a user connecting is online and broadcasts once', async () => {
    await presence.connect('u1', SCHOOL);

    expect(await presence.onlineUserIds(SCHOOL)).toEqual(['u1']);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ userId: 'u1', online: true });
  });

  test('a second connection does not re-broadcast online', async () => {
    await presence.connect('u1', SCHOOL);
    await presence.connect('u1', SCHOOL); // second tab/device

    const online = events.filter((e) => e.data.online);
    expect(online).toHaveLength(1);
    expect(await presence.onlineUserIds(SCHOOL)).toEqual(['u1']);
  });

  test('offline only fires when the last connection closes', async () => {
    await presence.connect('u1', SCHOOL);
    await presence.connect('u1', SCHOOL);

    await presence.disconnect('u1', SCHOOL);
    expect(events.some((e) => !e.data.online)).toBe(false);
    expect(await presence.onlineUserIds(SCHOOL)).toEqual(['u1']);

    await presence.disconnect('u1', SCHOOL);
    const offline = events.filter((e) => !e.data.online);
    expect(offline).toHaveLength(1);
    expect(offline[0].data.userId).toBe('u1');
    expect(await presence.onlineUserIds(SCHOOL)).toEqual([]);
  });

  test('tracks multiple users independently', async () => {
    await presence.connect('u1', SCHOOL);
    await presence.connect('u2', SCHOOL);

    const online = await presence.onlineUserIds(SCHOOL);
    expect(new Set(online)).toEqual(new Set(['u1', 'u2']));
  });
});
