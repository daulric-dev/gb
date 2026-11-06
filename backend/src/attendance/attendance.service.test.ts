import { afterEach, describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceService,
  CLAIM_OTHER_DEVICE_MESSAGE,
  MAX_SCAN_CLAIMS_PER_IP,
  MAX_WRONG_CODES,
  MOCK_LOCATION_MESSAGE,
  SESSION_LOCATION_MIN_INTERVAL_MS,
  tally,
} from './attendance.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { Prisma } from '@/generated/prisma/client';

/** Scan-device cookie values: the phone that scanned, and a friend's. */
const DEVICE = 'device-aaaaaaaaaaaaaaaaaa';
const OTHER_DEVICE = 'device-bbbbbbbbbbbbbbbbbb';

/**
 * A tiny in-memory database behind the Prisma mock: enough filters, unique
 * constraints and upsert semantics to run whole open → check-in → close flows.
 */
type Row = Record<string, any>;

/** Prisma model name → the table key the tests read. */
const TABLES: Record<string, string> = {
  attendance_session: 'course.attendance_session',
  course_attendance_record: 'course.attendance_record',
  course_student: 'course.course_student',
  course: 'course.course',
  student: 'student.student',
};

const cmp = (a: any, b: any) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([col, cond]) => {
    const v = row[col] ?? null;
    if (cond === null) return v === null;
    if (cond instanceof Date) return v !== null && cmp(v, cond) === 0;
    if (typeof cond === 'object') {
      if ('in' in cond) return cond.in.includes(v);
      if ('lte' in cond) return v !== null && cmp(v, cond.lte) <= 0;
      if ('gt' in cond) return v !== null && cmp(v, cond.gt) > 0;
      // A compound unique key, e.g. session_id_student_id: { ... }.
      return matches(row, cond);
    }
    return v === cond;
  });
}

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let seq = 0;

  const unique: Record<string, (a: Row, b: Row) => boolean> = {
    'course.attendance_session': (a, b) =>
      a.course_id === b.course_id && a.closed_at == null && b.closed_at == null,
    'course.attendance_record': (a, b) =>
      a.session_id === b.session_id && a.student_id === b.student_id,
  };
  const dup = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  const prisma = createMockPrisma();
  for (const [model, key] of Object.entries(TABLES)) {
    const rows = () => (tables[key] ??= []);
    const insert = (item: Row) => {
      const row = {
        id: `${key.split('.')[1]}-${++seq}`,
        closed_at: null,
        note: null,
        checked_in_at: null,
        distance_m: null,
        location_flags: [],
        ...item,
      };
      const clash = unique[key];
      const existing = clash ? rows().find((r) => clash(r, row)) : undefined;
      return { row, existing };
    };
    const m = prisma[model];
    m.findMany.mockImplementation(async ({ where, orderBy } = {}) => {
      const out = rows().filter((r) => matches(r, where)).map((r) => ({ ...r }));
      if (orderBy) {
        const [[col, dir]] = Object.entries(orderBy as Record<string, string>);
        out.sort((a, b) => cmp(a[col], b[col]) * (dir === 'desc' ? -1 : 1));
      }
      return out;
    });
    const first = async ({ where }: Row = {}) => {
      const hit = rows().find((r) => matches(r, where));
      return hit ? { ...hit } : null;
    };
    m.findFirst.mockImplementation(first);
    m.findUnique.mockImplementation(first);
    m.create.mockImplementation(async ({ data }) => {
      const { row, existing } = insert(data);
      if (existing) throw dup();
      rows().push(row);
      return { ...row };
    });
    m.createMany.mockImplementation(async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const item of data) {
        const { row, existing } = insert(item);
        if (existing) {
          if (skipDuplicates) continue;
          throw dup();
        }
        rows().push(row);
        count++;
      }
      return { count };
    });
    m.upsert.mockImplementation(async ({ where, create, update }) => {
      const hit = rows().find((r) => matches(r, where));
      if (hit) return { ...Object.assign(hit, update) };
      const { row } = insert(create);
      rows().push(row);
      return { ...row };
    });
    m.update.mockImplementation(async ({ where, data }) => {
      const hit = rows().find((r) => matches(r, where));
      if (!hit) {
        throw new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        });
      }
      return { ...Object.assign(hit, data) };
    });
    m.updateManyAndReturn.mockImplementation(async ({ where, data }) => {
      const hit = rows().filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return hit.map((r) => ({ ...r }));
    });
    m.deleteMany.mockImplementation(async ({ where }) => {
      const before = rows().length;
      tables[key] = rows().filter((r) => !matches(r, where));
      return { count: before - tables[key].length };
    });
  }
  return { prisma, tables };
}

const TEACHER = 'teacher-1';
const COURSE = 'course-1';
const STUDENTS = [
  { id: 'st-1', first_name: 'Jordan', last_name: 'Lee', user_profile_id: 'u-1' },
  { id: 'st-2', first_name: 'Priya', last_name: 'Shah', user_profile_id: 'u-2' },
  { id: 'st-3', first_name: 'Chloe', last_name: 'Martin', user_profile_id: null },
];

function setup(opts: { status?: string; role?: string } = {}) {
  const course = {
    id: COURSE,
    school_id: 'school-1',
    name: 'Biology 101',
    code: 'BIO-101',
    status: opts.status ?? 'published',
  };
  const sb = fakeDb({
    'course.course': [course],
    'course.course_student': [
      { course_id: COURSE, student_id: 'st-1', status: 'active' },
      { course_id: COURSE, student_id: 'st-2', status: 'active' },
      { course_id: COURSE, student_id: 'st-3', status: 'active' },
      { course_id: COURSE, student_id: 'st-9', status: 'dropped' },
    ],
    'student.student': STUDENTS,
    'course.attendance_session': [],
    'course.attendance_record': [],
  });
  const cache = withAtomicOps(createMockCacheService());
  const access = {
    require: async (_u: string, courseId: string, allowed: string[]) => {
      if (courseId !== COURSE) throw new NotFoundException('Course not found');
      const role = opts.role ?? 'teacher';
      if (!allowed.includes(role)) throw new ForbiddenException('nope');
      return { course, role };
    },
    requireStudent: async (studentId: string, courseId: string) => {
      const e = sb.tables['course.course_student'].find(
        (r) => r.course_id === courseId && r.student_id === studentId,
      );
      if (!e || e.status === 'dropped' || course.status !== 'published') {
        throw new NotFoundException('Course not found');
      }
      return course;
    },
  };
  const pushes: { userIds: string[]; message: any }[] = [];
  const push = {
    sendToUsers: async (userIds: string[], message: any) => {
      pushes.push({ userIds, message });
    },
  };
  const events: { channel: string; event: any }[] = [];
  const realtime = {
    publishStaff: async (id: string, event: any) => {
      events.push({ channel: `attendance:session:${id}`, event });
    },
    publishPortal: async (ids: string[], event: any) => {
      for (const id of ids.filter(Boolean)) {
        events.push({ channel: `portal:user:${id}`, event });
      }
    },
  };
  const service = new AttendanceService(
    sb.prisma as any,
    cache as any,
    access as any,
    push as any,
    realtime as any,
    createMockErasureLog() as any,
  );
  return { service, sb, cache, pushes, events };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** The shared cache mock plus the atomic ops attendance relies on. */
function withAtomicOps(cache: ReturnType<typeof createMockCacheService>) {
  const store = cache._store;
  return Object.assign(cache, {
    setIfAbsent: (key: string, value: any, ttl: number) => {
      if (store.has(key)) return Promise.resolve(false);
      store.set(key, { value, ttl });
      return Promise.resolve(true);
    },
    incr: (key: string, ttl: number) => {
      const entry = store.get(key);
      const value = (Number(entry?.value) || 0) + 1;
      store.set(key, { value, ttl: entry?.ttl ?? ttl });
      return Promise.resolve(value);
    },
  });
}

/** Move a session's window into the past, as if minutes had gone by. */
function age(sb: ReturnType<typeof fakeDb>, sessionId: string, minutes: number) {
  const s = sb.tables['course.attendance_session'].find((r) => r.id === sessionId)!;
  const shift = (d: Date) => new Date(d.getTime() - minutes * 60_000);
  s.opened_at = shift(s.opened_at);
  s.closes_at = shift(s.closes_at);
}

describe('AttendanceService.open', () => {
  test('creates a 4-digit code and notifies students with accounts', async () => {
    const { service, pushes, events } = setup();
    const detail = await service.open(TEACHER, COURSE, {});

    expect(detail.checkInCode).toMatch(/^[0-9]{4}$/);
    expect(detail.requiresCode).toBe(true);
    expect(detail.isOpen).toBe(true);
    expect(detail.counts.pending).toBe(3);
    expect(detail.roster.map((r) => r.lastName)).toEqual(['Lee', 'Martin', 'Shah']);
    expect(Date.parse(detail.closesAt) - Date.parse(detail.openedAt)).toBe(5 * 60_000);

    await tick();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].userIds.sort()).toEqual(['u-1', 'u-2']);
    expect(pushes[0].message).toEqual({
      title: 'Attendance is open',
      body: 'Biology 101: tap to check in',
      channelId: 'attendance',
      data: { type: 'attendance.opened', sessionId: detail.id, courseId: COURSE },
    });
    const opened = events.filter((e) => e.event.type === 'attendance.opened');
    expect(opened.map((e) => e.channel).sort()).toEqual([
      'portal:user:u-1',
      'portal:user:u-2',
    ]);
    expect(JSON.stringify(opened[0].event.data)).not.toContain(detail.checkInCode!);
  });

  test('no code when not required; location defaults to 100 m', async () => {
    const { service } = setup();
    const detail = await service.open(TEACHER, COURSE, {
      requireCode: false,
      location: { latitude: 10, longitude: 20 },
    });
    expect(detail.checkInCode).toBeNull();
    expect(detail.requiresCode).toBe(false);
    expect(detail.location).toEqual({ latitude: 10, longitude: 20, radiusM: 100 });
    expect(detail.locationUpdatedAt).toBe(detail.openedAt);
  });

  test('a second open in the same course is a conflict', async () => {
    const { service } = setup();
    await service.open(TEACHER, COURSE, {});
    const err = await expectRejection(service.open(TEACHER, COURSE, {}));
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe('Attendance is already open in this course');
  });

  test('an expired, unfinalised session does not block a new one', async () => {
    const { service, sb } = setup();
    const first = await service.open(TEACHER, COURSE, {});
    age(sb, first.id, 10);
    const second = await service.open(TEACHER, COURSE, {});
    expect(second.id).not.toBe(first.id);
    const old = sb.tables['course.attendance_session'].find((s) => s.id === first.id)!;
    expect(old.closed_at).not.toBeNull();
  });

  test('an unpublished course is refused', async () => {
    const { service } = setup({ status: 'draft' });
    expect(await expectRejection(service.open(TEACHER, COURSE, {}))).toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('AttendanceService.checkIn', () => {
  test('wrong code is 409, then 429 after the limit', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const wrong = s.checkInCode === '0000' ? '1111' : '0000';

    for (let i = 0; i < MAX_WRONG_CODES; i++) {
      const err = await expectRejection(service.checkIn('st-1', s.id, { code: wrong }));
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toBe('That code is not right');
    }
    const err = await expectRejection(
      service.checkIn('st-1', s.id, { code: s.checkInCode! }),
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);

    // Another student is unaffected.
    const ok = await service.checkIn('st-2', s.id, { code: s.checkInCode! });
    expect(ok.myStatus).toBe('present');
  });

  test('the counter lives for the session plus a margin', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, { durationMinutes: 10 });
    const wrong = s.checkInCode === '0000' ? '1111' : '0000';
    await expectRejection(service.checkIn('st-1', s.id, { code: wrong }));
    const entry = cache._store.get(`attendance:wrong-code:${s.id}:st-1`);
    expect(entry?.value).toBe(1);
    expect(entry!.ttl).toBeGreaterThan(10 * 60);
  });

  test('a missing code is a 400 and not counted', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    expect(await expectRejection(service.checkIn('st-1', s.id, {}))).toBeInstanceOf(
      BadRequestException,
    );
    expect(cache._store.size).toBe(0);
  });

  test('right code is present, published to staff, and never echoes the code', async () => {
    const { service, events } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const res = await service.checkIn('st-1', s.id, { code: s.checkInCode! });
    expect(res).toEqual({
      sessionId: s.id,
      courseId: COURSE,
      courseName: 'Biology 101',
      title: null,
      openedAt: s.openedAt,
      closesAt: s.closesAt,
      requiresCode: true,
      requiresLocation: false,
      myStatus: 'present',
    });
    await tick();
    const rec = events.find((e) => e.event.type === 'attendance.record');
    expect(rec?.channel).toBe(`attendance:session:${s.id}`);
    expect(rec?.event.data).toMatchObject({
      studentId: 'st-1',
      status: 'present',
      method: 'self',
      hasAccount: true,
    });
  });

  test('a scanned QR token stands in for the code and is recorded as qr', async () => {
    const { service, events } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const frame = await service.qr(TEACHER, COURSE, s.id);
    expect(frame.url).toContain(`/scan?s=${s.id}&t=${frame.token}`);

    const res = await service.checkIn('st-1', s.id, { qrToken: frame.token });
    expect(res.myStatus).toBe('present');
    await tick();
    const rec = events.find((e) => e.event.type === 'attendance.record');
    expect(rec?.event.data).toMatchObject({ studentId: 'st-1', method: 'qr' });
  });

  test('a scan claim checks in once and is bound to the first student', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const frame = await service.qr(TEACHER, COURSE, s.id);
    const { claim } = await service.scanClaim(s.id, frame.token, DEVICE);

    const res = await service.checkIn('st-1', s.id, {
      qrClaim: claim,
      scanDeviceId: DEVICE,
    });
    expect(res.myStatus).toBe('present');

    // Another student signed in on the same device: refused, not a second
    // check-in.
    await expect(
      service.checkIn('st-2', s.id, { qrClaim: claim, scanDeviceId: DEVICE }),
    ).rejects.toThrow('expired');
  });

  test('a claim forwarded to another device does not redeem there', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const frame = await service.qr(TEACHER, COURSE, s.id);
    const { claim } = await service.scanClaim(s.id, frame.token, DEVICE);

    for (const scanDeviceId of [OTHER_DEVICE, undefined]) {
      const err = await service
        .checkIn('st-2', s.id, { qrClaim: claim, scanDeviceId })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe(CLAIM_OTHER_DEVICE_MESSAGE);
    }
    // Nothing was recorded against the claim, so the scanning student can
    // still use it.
    expect(
      [...cache._store.keys()].some((k) => k.startsWith('attendance:qr-claim:')),
    ).toBe(false);
    const res = await service.checkIn('st-1', s.id, {
      qrClaim: claim,
      scanDeviceId: DEVICE,
    });
    expect(res.myStatus).toBe('present');
  });

  test('a whole class on one school network can get claims', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const frame = await service.qr(TEACHER, COURSE, s.id);
    for (let i = 0; i < 35; i++) {
      await expect(
        service.scanClaim(s.id, frame.token, `device-${i}`.padEnd(22, 'x'), '203.0.113.7'),
      ).resolves.toHaveProperty('claim');
    }
  });

  test('one address gets a limited number of claims per session', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const frame = await service.qr(TEACHER, COURSE, s.id);
    for (let i = 0; i < MAX_SCAN_CLAIMS_PER_IP; i++) {
      await service.scanClaim(s.id, frame.token, DEVICE, '203.0.113.7');
    }
    const err = await service
      .scanClaim(s.id, frame.token, DEVICE, '203.0.113.7')
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.message).toContain('Too many scans');

    // Another address still gets a claim; the counter lasts one claim lifetime.
    await expect(
      service.scanClaim(s.id, frame.token, DEVICE, '198.51.100.2'),
    ).resolves.toHaveProperty('claim');
    const entry = cache._store.get(
      `attendance:scan-claims:${s.id}:203.0.113.7`,
    );
    expect(entry?.ttl).toBe(5 * 60);
  });

  test('an expired QR token does not use up the claim budget', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    await expect(
      service.scanClaim(s.id, 'AAAAAAAAAAAAAAAAAAAAAA', DEVICE, '203.0.113.7'),
    ).rejects.toThrow('expired');
    expect(cache._store.has(`attendance:scan-claims:${s.id}:203.0.113.7`)).toBe(
      false,
    );
  });

  test('a scan claim is refused when the counter is unavailable', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const frame = await service.qr(TEACHER, COURSE, s.id);
    cache.incr = () => Promise.reject(new Error('redis down'));
    await expect(
      service.scanClaim(s.id, frame.token, DEVICE, '203.0.113.7'),
    ).rejects.toThrow('unavailable');
  });

  test('the same student may retry a claim after a location error', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, {
      location: { latitude: 51.5, longitude: -0.12, radiusM: 100 },
    });
    const frame = await service.qr(TEACHER, COURSE, s.id);
    const { claim } = await service.scanClaim(s.id, frame.token, DEVICE);
    await expect(
      service.checkIn('st-1', s.id, { qrClaim: claim, scanDeviceId: DEVICE }),
    ).rejects.toThrow('location');
    const res = await service.checkIn('st-1', s.id, {
      qrClaim: claim,
      scanDeviceId: DEVICE,
      location: { latitude: 51.5, longitude: -0.12, accuracy: 10 },
    });
    expect(res.myStatus).toBe('present');
  });

  test('parallel wrong codes cannot exceed the limit', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const wrong = s.checkInCode === '0000' ? '1111' : '0000';
    const results = await Promise.allSettled(
      Array.from({ length: MAX_WRONG_CODES + 5 }, () =>
        service.checkIn('st-1', s.id, { code: wrong }),
      ),
    );
    const limited = results.filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof HttpException &&
        r.reason.getStatus() === 429,
    );
    expect(limited).toHaveLength(5);
  });

  test('a forged QR token is refused and not counted as a wrong code', async () => {
    const { service, cache } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    await expect(
      service.checkIn('st-1', s.id, { qrToken: 'AAAAAAAAAAAAAAAAAAAAAA' }),
    ).rejects.toThrow('expired');
    expect(cache._store.size).toBe(0);
  });

  test('past the late threshold is late', async () => {
    const { service, sb } = setup();
    const s = await service.open(TEACHER, COURSE, {
      requireCode: false,
      lateAfterMinutes: 2,
      durationMinutes: 10,
    });
    age(sb, s.id, 3);
    const res = await service.checkIn('st-1', s.id, {});
    expect(res.myStatus).toBe('late');
  });

  test('geofence: inside passes with distance kept, outside is refused', async () => {
    const { service, sb } = setup();
    const s = await service.open(TEACHER, COURSE, {
      requireCode: false,
      location: { latitude: 51.5, longitude: -0.12, radiusM: 100 },
    });

    expect(await expectRejection(service.checkIn('st-1', s.id, {}))).toBeInstanceOf(
      BadRequestException,
    );

    // ~0.0018 deg latitude ≈ 200 m: outside 100 m even with 50 m accuracy.
    expect(
      await expectRejection(
        service.checkIn('st-1', s.id, {
          location: { latitude: 51.5018, longitude: -0.12, accuracy: 500 },
        }),
      ),
    ).toBeInstanceOf(ForbiddenException);

    // ~133 m: outside the radius, inside radius + 50 m accuracy allowance.
    const ok = await service.checkIn('st-1', s.id, {
      location: { latitude: 51.5012, longitude: -0.12, accuracy: 80 },
    });
    expect(ok.myStatus).toBe('present');
    const rec = sb.tables['course.attendance_record'].find((r) => r.student_id === 'st-1')!;
    expect(rec.distance_m).toBeGreaterThan(120);
    expect(rec.distance_m).toBeLessThan(140);
  });

  test('checking in twice is a conflict', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.checkIn('st-1', s.id, {});
    const err = await expectRejection(service.checkIn('st-1', s.id, {}));
    expect(err).toBeInstanceOf(ConflictException);
  });

  test('closed or expired sessions refuse check-in', async () => {
    const { service, sb } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    age(sb, s.id, 6);
    const err = await expectRejection(service.checkIn('st-1', s.id, {}));
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe('Attendance has closed');

    const t = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.close(TEACHER, COURSE, t.id);
    const err2 = await expectRejection(service.checkIn('st-1', t.id, {}));
    expect((err2 as Error).message).toBe('Attendance has closed');
  });

  test('a dropped student cannot check in', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    expect(await expectRejection(service.checkIn('st-9', s.id, {}))).toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AttendanceService finalising', () => {
  test('closing marks absentees, announces once, and is idempotent', async () => {
    const { service, sb, events } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.checkIn('st-1', s.id, {});

    const closed = await service.close(TEACHER, COURSE, s.id);
    expect(closed.isOpen).toBe(false);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.counts).toEqual({ present: 1, late: 0, absent: 2, excused: 0, pending: 0 });
    const absent = closed.roster.filter((r) => r.status === 'absent');
    expect(absent.every((r) => r.method === 'auto')).toBe(true);

    await tick();
    const announced = events.filter((e) => e.event.type === 'attendance.closed');
    expect(announced.map((e) => e.channel).sort()).toEqual([
      `attendance:session:${s.id}`,
      'portal:user:u-1',
      'portal:user:u-2',
    ]);

    // Again: nothing new, nothing re-announced.
    const row = sb.tables['course.attendance_session'].find((r) => r.id === s.id)!;
    const again = await service.finalize({
      ...row,
      opened_at: row.opened_at.toISOString(),
      closes_at: row.closes_at.toISOString(),
      closed_at: null,
    } as any);
    await service.close(TEACHER, COURSE, s.id);
    await tick();
    expect(again.closed_at).toBe(row.closed_at.toISOString());
    expect(sb.tables['course.attendance_record']).toHaveLength(3);
    expect(events.filter((e) => e.event.type === 'attendance.closed')).toHaveLength(3);
  });

  test('the sweep finalises expired sessions only', async () => {
    const { service, sb } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    expect(await service.finalizeExpired()).toBe(0);
    age(sb, s.id, 6);
    await service.sweep();
    const row = sb.tables['course.attendance_session'].find((r) => r.id === s.id)!;
    expect(row.closed_at).toEqual(row.closes_at);
    expect(sb.tables['course.attendance_record']).toHaveLength(3);
    await service.sweep();
    expect(sb.tables['course.attendance_record']).toHaveLength(3);
  });

  test('reading an expired session finalises it', async () => {
    const { service, sb } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    age(sb, s.id, 6);
    const detail = await service.detail(TEACHER, COURSE, s.id);
    expect(detail.isOpen).toBe(false);
    expect(detail.counts.absent).toBe(3);
  });
});

describe('AttendanceService.setRecord', () => {
  test('teacher overrides an auto absence, keeping it after close', async () => {
    const { service, sb, events } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.close(TEACHER, COURSE, s.id);

    const entry = await service.setRecord(TEACHER, COURSE, s.id, 'st-2', {
      status: 'excused',
      note: ' Doctor ',
    });
    expect(entry).toEqual({
      studentId: 'st-2',
      firstName: 'Priya',
      lastName: 'Shah',
      hasAccount: true,
      status: 'excused',
      method: 'teacher',
      checkedInAt: null,
      distanceM: null,
      accuracyM: null,
      locationFlags: [],
      note: 'Doctor',
    });
    expect(
      sb.tables['course.attendance_record'].filter((r) => r.student_id === 'st-2'),
    ).toHaveLength(1);
    await tick();
    expect(events.some((e) => e.event.type === 'attendance.record')).toBe(true);
  });

  test('a student not in the course is not found', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    expect(
      await expectRejection(
        service.setRecord(TEACHER, COURSE, s.id, 'st-404', { status: 'present' }),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a TA may mark but not delete', async () => {
    const { service } = setup({ role: 'ta' });
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.setRecord(TEACHER, COURSE, s.id, 'st-1', { status: 'late' });
    expect(await expectRejection(service.remove(TEACHER, COURSE, s.id))).toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('AttendanceService.summary and export', () => {
  test('rate is (present + late) / (sessions - excused)', async () => {
    const { service } = setup();
    // Session 1: Jordan present, Priya excused, Chloe absent.
    const a = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.checkIn('st-1', a.id, {});
    await service.setRecord(TEACHER, COURSE, a.id, 'st-2', { status: 'excused' });
    await service.close(TEACHER, COURSE, a.id);
    // Session 2: Jordan late, Priya absent, Chloe absent.
    const b = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.setRecord(TEACHER, COURSE, b.id, 'st-1', { status: 'late' });
    await service.close(TEACHER, COURSE, b.id);
    // Session 3: everyone absent.
    const c = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.close(TEACHER, COURSE, c.id);

    const summary = await service.summary(TEACHER, COURSE);
    expect(summary.sessionCount).toBe(3);
    const by = Object.fromEntries(summary.students.map((s) => [s.firstName, s]));
    expect(by.Jordan).toMatchObject({ present: 1, late: 1, absent: 1, rate: 66.7 });
    expect(by.Priya).toMatchObject({ excused: 1, absent: 2, rate: 0 });
    expect(by.Chloe).toMatchObject({ absent: 3, rate: 0 });

    const { csv, filename } = await service.exportCsv(TEACHER, COURSE);
    expect(filename).toBe('BIO-101-attendance.csv');
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEndWith('Present,Late,Absent,Excused,Rate %');
    expect(lines[1]).toBe('Lee,Jordan,Present,Late,Absent,1,1,1,0,66.7');
  });

  test('no sessions means a null rate', async () => {
    const { service } = setup();
    const summary = await service.summary(TEACHER, COURSE);
    expect(summary.sessionCount).toBe(0);
    expect(summary.students.every((s) => s.rate === null)).toBe(true);
  });

  test('export defuses formula-looking names', async () => {
    const { service, sb } = setup();
    sb.tables['student.student'][0].last_name = '=HYPERLINK("x")';
    const { csv } = await service.exportCsv(TEACHER, COURSE);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  test('tally', () => {
    expect(tally([])).toEqual({ present: 0, late: 0, absent: 0, excused: 0, rate: null });
    expect(tally([{ status: 'excused' }]).rate).toBeNull();
    expect(tally([{ status: 'present' }, { status: 'absent' }]).rate).toBe(50);
  });
});

describe('AttendanceService portal', () => {
  test('open sessions show without the code; my status after check-in', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, {});
    const open = await service.openForStudent('st-1');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ sessionId: s.id, courseName: 'Biology 101', myStatus: null });
    expect(JSON.stringify(open)).not.toContain('checkInCode');

    await service.checkIn('st-1', s.id, { code: s.checkInCode! });
    expect((await service.openForStudent('st-1'))[0].myStatus).toBe('present');
    expect(await service.openForStudent('st-9')).toEqual([]);
  });

  test('course attendance lists my records and summary', async () => {
    const { service } = setup();
    const s = await service.open(TEACHER, COURSE, { requireCode: false });
    await service.checkIn('st-1', s.id, {});
    await service.close(TEACHER, COURSE, s.id);

    const mine = await service.courseForStudent('st-1', COURSE);
    expect(mine.summary).toEqual({ present: 1, late: 0, absent: 0, excused: 0, rate: 100 });
    expect(mine.records).toHaveLength(1);
    expect(mine.records[0]).toMatchObject({ sessionId: s.id, status: 'present' });
  });
});

afterEach(() => undefined);

/** Pretend the session point was last set `ms` ago, past the throttle. */
function staleLocation(sb: ReturnType<typeof fakeDb>, sessionId: string, ms = 60_000) {
  const s = sb.tables['course.attendance_session'].find((r) => r.id === sessionId)!;
  s.location_updated_at = new Date(Date.now() - ms);
}

const record = (sb: ReturnType<typeof fakeDb>, studentId: string) =>
  sb.tables['course.attendance_record'].find((r) => r.student_id === studentId)!;

describe('AttendanceService.updateLocation', () => {
  async function located(opts: { role?: string } = {}) {
    const ctx = setup(opts);
    const session = await ctx.service.open(TEACHER, COURSE, {
      requireCode: false,
      location: { latitude: 51.5, longitude: -0.12, radiusM: 100 },
    });
    return { ...ctx, session };
  }

  test('moves the point of an open session, stamps it and tells staff', async () => {
    const { service, sb, events, session } = await located();
    staleLocation(sb, session.id);
    const out = await service.updateLocation(TEACHER, COURSE, session.id, {
      latitude: 51.51,
      longitude: -0.13,
      accuracy: 12,
    });
    expect(out!.location).toEqual({ latitude: 51.51, longitude: -0.13, radiusM: 100 });
    expect(Date.now() - Date.parse(out!.locationUpdatedAt)).toBeLessThan(5_000);

    const detail = await service.detail(TEACHER, COURSE, session.id);
    expect(detail.location).toEqual(out!.location);
    expect(detail.locationUpdatedAt).toBe(out!.locationUpdatedAt);
    await tick();
    expect(events.some((e) => e.event.type === 'attendance.location')).toBe(true);
  });

  test('takes the same course role as opening: any staff role, nobody else', async () => {
    const ta = await located({ role: 'ta' });
    staleLocation(ta.sb, ta.session.id);
    expect(
      await ta.service.updateLocation(TEACHER, COURSE, ta.session.id, {
        latitude: 51.5,
        longitude: -0.12,
      }),
    ).not.toBeNull();

    const { service, session } = await located();
    expect(
      await expectRejection(
        service.updateLocation(TEACHER, 'other-course', session.id, {
          latitude: 51.5,
          longitude: -0.12,
        }),
      ),
    ).toBeInstanceOf(NotFoundException);

    // A role outside STAFF_ROLES is refused before anything is read.
    const outsider = setup({ role: 'student' });
    expect(
      await expectRejection(
        outsider.service.updateLocation(TEACHER, COURSE, session.id, {
          latitude: 51.5,
          longitude: -0.12,
        }),
      ),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a closed session or one without a location check is a conflict', async () => {
    const { service, sb, session } = await located();
    await service.close(TEACHER, COURSE, session.id);
    staleLocation(sb, session.id);
    const err = await expectRejection(
      service.updateLocation(TEACHER, COURSE, session.id, { latitude: 1, longitude: 1 }),
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe('Attendance has closed');

    const plain = await service.open(TEACHER, COURSE, { requireCode: false });
    const err2 = await expectRejection(
      service.updateLocation(TEACHER, COURSE, plain.id, { latitude: 1, longitude: 1 }),
    );
    expect(err2).toBeInstanceOf(ConflictException);
    expect((err2 as Error).message).toBe('This session has no location check');
  });

  test('a fix worse than 100 m is ignored and the point stays', async () => {
    const { service, sb, session } = await located();
    staleLocation(sb, session.id);
    const out = await service.updateLocation(TEACHER, COURSE, session.id, {
      latitude: 52,
      longitude: 0,
      accuracy: 150,
    });
    expect(out).toBeNull();
    const row = sb.tables['course.attendance_session'].find((r) => r.id === session.id)!;
    expect(row.latitude).toBe(51.5);
    expect(row.longitude).toBe(-0.12);

    // Exactly 100 m is still usable.
    expect(
      await service.updateLocation(TEACHER, COURSE, session.id, {
        latitude: 52,
        longitude: 0,
        accuracy: 100,
      }),
    ).not.toBeNull();
  });

  test('more than one update per session every 5 s is refused with 429', async () => {
    const { service, sb, session } = await located();
    // Just opened: the point was set moments ago.
    const err = await expectRejection(
      service.updateLocation(TEACHER, COURSE, session.id, { latitude: 51.5, longitude: -0.12 }),
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);

    staleLocation(sb, session.id, SESSION_LOCATION_MIN_INTERVAL_MS + 1);
    await service.updateLocation(TEACHER, COURSE, session.id, { latitude: 51.5, longitude: -0.12 });
    const again = await expectRejection(
      service.updateLocation(TEACHER, COURSE, session.id, { latitude: 51.5, longitude: -0.12 }),
    );
    expect((again as HttpException).getStatus()).toBe(429);
  });

  test('check-ins are measured against the moved point', async () => {
    const { service, sb, session } = await located();
    // ~1.1 km north of where the session opened.
    const there = { latitude: 51.51, longitude: -0.12, accuracy: 10 };
    expect(
      await expectRejection(service.checkIn('st-1', session.id, { location: there })),
    ).toBeInstanceOf(ForbiddenException);

    staleLocation(sb, session.id);
    await service.updateLocation(TEACHER, COURSE, session.id, {
      latitude: 51.5101,
      longitude: -0.12,
      accuracy: 8,
    });
    const ok = await service.checkIn('st-1', session.id, { location: there });
    expect(ok.myStatus).toBe('present');
    expect(record(sb, 'st-1').distance_m).toBeLessThan(20);
  });
});

describe('AttendanceService.checkIn location readings', () => {
  async function located(requireCode = false) {
    const ctx = setup();
    const session = await ctx.service.open(TEACHER, COURSE, {
      requireCode,
      location: { latitude: 51.5, longitude: -0.12, radiusM: 100 },
    });
    return { ...ctx, session };
  }
  const near = { latitude: 51.500234567, longitude: -0.120345678, accuracy: 12 };

  test('a mocked reading is refused with 403 and costs no code attempt', async () => {
    const { service, cache, session } = await located(true);
    for (let i = 0; i < MAX_WRONG_CODES + 2; i++) {
      const err = await expectRejection(
        service.checkIn('st-1', session.id, {
          code: '0000',
          location: { ...near, mocked: true },
        }),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe(MOCK_LOCATION_MESSAGE);
    }
    expect(cache._store.has(`attendance:wrong-code:${session.id}:st-1`)).toBe(false);

    const ok = await service.checkIn('st-1', session.id, {
      code: session.checkInCode!,
      location: { ...near, mocked: false },
    });
    expect(ok.myStatus).toBe('present');
  });

  test('stores coordinates, accuracy and distance; a clean reading has no flags', async () => {
    const { service, sb, session } = await located();
    await service.checkIn('st-1', session.id, { location: near, nativeClient: true });
    const rec = record(sb, 'st-1');
    expect(rec.latitude).toBe(near.latitude);
    expect(rec.longitude).toBe(near.longitude);
    expect(rec.accuracy_m).toBe(12);
    expect(rec.distance_m).toBeGreaterThan(20);
    expect(rec.location_flags).toEqual([]);

    const detail = await service.detail(TEACHER, COURSE, session.id);
    const entry = detail.roster.find((r) => r.studentId === 'st-1')!;
    expect(entry.locationFlags).toEqual([]);
    expect(entry.accuracyM).toBe(12);
  });

  test('exact_point: within 1 m of the session point', async () => {
    const { service, sb, session } = await located();
    await service.checkIn('st-1', session.id, {
      location: { latitude: 51.5000001, longitude: -0.1200001, accuracy: 5 },
    });
    expect(record(sb, 'st-1').location_flags).toEqual(['exact_point']);
  });

  test('zero_accuracy: 0 anywhere, missing only from the app', async () => {
    const { service, sb, session } = await located();
    await service.checkIn('st-1', session.id, {
      location: { ...near, accuracy: 0 },
    });
    expect(record(sb, 'st-1').location_flags).toEqual(['zero_accuracy']);

    await service.checkIn('st-2', session.id, {
      location: { latitude: 51.500111111, longitude: -0.120222222 },
      nativeClient: true,
    });
    expect(record(sb, 'st-2').location_flags).toEqual(['zero_accuracy']);

    await service.checkIn('st-3', session.id, {
      location: { latitude: 51.500333333, longitude: -0.120444444 },
    });
    expect(record(sb, 'st-3').location_flags).toEqual([]);
  });

  test('low_precision: both coordinates with 3 decimals or fewer', async () => {
    const { service, sb, session } = await located();
    await service.checkIn('st-1', session.id, {
      location: { latitude: 51.5, longitude: -0.121, accuracy: 20 },
    });
    expect(record(sb, 'st-1').location_flags).toEqual(['low_precision']);

    // One precise coordinate is enough to not flag.
    await service.checkIn('st-2', session.id, {
      location: { latitude: 51.5004, longitude: -0.120456789, accuracy: 20 },
    });
    expect(record(sb, 'st-2').location_flags).toEqual([]);
  });

  test('duplicate_coords flags the later check-in and, after the fact, the earlier one', async () => {
    const { service, sb, events, session } = await located();
    await service.checkIn('st-1', session.id, { location: near });
    expect(record(sb, 'st-1').location_flags).toEqual([]);

    // Same to 6 decimals, different beyond.
    await service.checkIn('st-2', session.id, {
      location: { latitude: 51.5002345671, longitude: -0.1203456779, accuracy: 30 },
    });
    expect(record(sb, 'st-2').location_flags).toEqual(['duplicate_coords']);
    expect(record(sb, 'st-1').location_flags).toEqual(['duplicate_coords']);

    // The earlier row is re-sent to staff with its new flag.
    await tick();
    const st1 = events.filter(
      (e) => e.event.type === 'attendance.record' && e.event.data.studentId === 'st-1',
    );
    expect(st1.at(-1)!.event.data.locationFlags).toEqual(['duplicate_coords']);

    // A third different reading is untouched.
    await service.checkIn('st-3', session.id, {
      location: { latitude: 51.500111111, longitude: -0.120222222, accuracy: 9 },
    });
    expect(record(sb, 'st-3').location_flags).toEqual([]);
  });

  test('flags never reach the student', async () => {
    const { service, session } = await located();
    const out = await service.checkIn('st-1', session.id, {
      location: { latitude: 51.5, longitude: -0.12, accuracy: 0 },
    });
    expect(JSON.stringify(out)).not.toContain('flag');
    const mine = await service.courseForStudent('st-1', COURSE);
    expect(JSON.stringify(mine)).not.toContain('flag');
    expect(JSON.stringify(mine)).not.toContain('accuracy');
  });

  test('no location check means no coordinates are kept', async () => {
    const ctx = setup();
    const s = await ctx.service.open(TEACHER, COURSE, { requireCode: false });
    await ctx.service.checkIn('st-1', s.id, { location: { ...near, mocked: true } });
    const rec = record(ctx.sb, 'st-1');
    expect(rec.latitude ?? null).toBeNull();
    expect(rec.location_flags).toEqual([]);
  });
});
