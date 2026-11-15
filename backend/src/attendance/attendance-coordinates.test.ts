/**
 * Raw check-in coordinates are cleared when a session closes (retention:
 * src/retention clears any left, and the session's own point, later).
 */
import { expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { AttendanceService } from './attendance.service';

const SESSION = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';

function setup() {
  const prisma = createMockPrisma();
  const opened = new Date('2026-12-10T09:00:00Z');
  const closes = new Date('2026-12-10T09:10:00Z');
  prisma.attendance_session.updateManyAndReturn.mockResolvedValue([
    {
      id: SESSION,
      course_id: COURSE,
      title: null,
      opened_by: null,
      opened_at: opened,
      closes_at: closes,
      closed_at: closes,
      check_in_code: null,
      late_after_minutes: null,
      latitude: 51.5,
      longitude: -0.12,
      radius_m: 50,
      location_updated_at: opened,
      qr_secret: null,
    },
  ]);
  const realtime = { publishStaff: mock(async () => undefined), publishPortal: mock(async () => undefined) };
  const service = new AttendanceService(
    prisma as any,
    createMockCacheService() as any,
    {} as any,
    {} as any,
    realtime as any,
    createMockErasureLog() as any,
  );
  const session = {
    id: SESSION,
    course_id: COURSE,
    opened_at: opened.toISOString(),
    closes_at: closes.toISOString(),
    closed_at: null,
  };
  return { prisma, service, session };
}

test('closing a session clears its check-ins\' raw coordinates', async () => {
  const { prisma, service, session } = setup();
  await service.finalize(session as any);
  expect(prisma.course_attendance_record.updateMany.mock.calls[0][0]).toEqual({
    where: { session_id: SESSION, OR: [{ latitude: { not: null } }, { longitude: { not: null } }] },
    data: { latitude: null, longitude: null },
  });
});

test('a failure to clear them does not fail the close', async () => {
  const { prisma, service, session } = setup();
  prisma.course_attendance_record.updateMany.mockRejectedValue(new Error('db down'));
  const closed = await service.finalize(session as any);
  expect(closed.id).toBe(SESSION);
});

test('an already closed session is left alone', async () => {
  const { prisma, service, session } = setup();
  await service.finalize({ ...session, closed_at: session.closes_at } as any);
  expect(prisma.course_attendance_record.updateMany).not.toHaveBeenCalled();
});
