import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { WebhookEvents } from './webhook-events.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const HOOKS = [{ id: 'h-1' }, { id: 'h-2' }];
const DATA = {
  course: { id: '22222222-2222-4222-8222-222222222222', name: 'Maths', code: null },
  createdBy: null,
};

function setup(opts: { feature?: boolean; hooks?: { id: string }[] } = {}) {
  const prisma = createMockPrisma();
  prisma.school_webhook.findMany.mockResolvedValue(opts.hooks ?? HOOKS);
  prisma.school.findUnique.mockResolvedValue({ id: SCHOOL, name: 'Riverside' });
  prisma.webhook_delivery.createManyAndReturn.mockImplementation(async ({ data }: any) =>
    data.map((_: unknown, i: number) => ({ id: `d-${i}` })),
  );
  const features = { isEnabled: mock(async () => opts.feature ?? true) };
  const deliveries = { schedule: mock(async () => {}) };
  const worker = { kick: mock(() => {}) };
  const events = new WebhookEvents(prisma as any, features as any, deliveries as any, worker as any);
  return { events, prisma, features, deliveries, worker };
}

describe('WebhookEvents.emit', () => {
  test('queues one delivery per subscribed webhook with the same three-key envelope', async () => {
    const { events, prisma, deliveries, worker } = setup();
    expect(await events.emit(SCHOOL, 'course.created', DATA)).toBe(2);
    expect(prisma.school_webhook.findMany.mock.calls[0][0].where).toEqual({
      school_id: SCHOOL,
      enabled: true,
      event_subscriptions: { some: { event_type: 'course.created' } },
    });
    const rows = prisma.webhook_delivery.createManyAndReturn.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.webhook_id)).toEqual(['h-1', 'h-2']);
    expect(rows[0].event_id).toBe(rows[1].event_id);
    expect(rows[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].payload).toEqual({
      event_type: 'course.created',
      message: 'Maths was created',
      data: { school: { id: SCHOOL, name: 'Riverside' }, ...DATA },
    });
    expect(Object.keys(rows[0].payload)).toEqual(['event_type', 'message', 'data']);
    expect(Object.keys(rows[0].payload.data)[0]).toBe('school');
    expect(deliveries.schedule).toHaveBeenCalledWith(['d-0', 'd-1']);
    expect(worker.kick).toHaveBeenCalled();
  });

  test('with integrations off nothing is looked up, built or queued', async () => {
    const { events, prisma } = setup({ feature: false });
    const build = mock(async () => DATA);
    expect(await events.emit(SCHOOL, 'course.created', build)).toBe(0);
    expect(prisma.school_webhook.findMany).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(prisma.webhook_delivery.createManyAndReturn).not.toHaveBeenCalled();
  });

  test('with no subscribed webhook the payload is never built', async () => {
    const { events, prisma } = setup({ hooks: [] });
    const build = mock(async () => DATA);
    expect(await events.emit(SCHOOL, 'course.created', build)).toBe(0);
    expect(build).not.toHaveBeenCalled();
    expect(prisma.webhook_delivery.createManyAndReturn).not.toHaveBeenCalled();
  });

  test('never throws into the caller', async () => {
    const { events, prisma } = setup();
    prisma.webhook_delivery.createManyAndReturn.mockRejectedValue(new Error('db down'));
    expect(await events.emit(SCHOOL, 'course.created', DATA)).toBe(0);
    const failing = setup();
    expect(
      await failing.events.emit(SCHOOL, 'course.created', async () => {
        throw new Error('builder broke');
      }),
    ).toBe(0);
    expect(await events.emit(null, 'course.created', DATA)).toBe(0);
  });

  test('emitForCourse finds the school from the course', async () => {
    const { events, prisma } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: DATA.course.id, school_id: SCHOOL, name: 'Maths', code: null });
    await events.emitForCourse(DATA.course.id, 'course.archived', (course) => ({ course }));
    const row = prisma.webhook_delivery.createManyAndReturn.mock.calls[0][0].data[0];
    expect(row.school_id).toBe(SCHOOL);
    expect(row.payload.data).toEqual({ school: { id: SCHOOL, name: 'Riverside' }, course: DATA.course });
    expect(row.payload.message).toBe('Maths was archived');
  });
});
