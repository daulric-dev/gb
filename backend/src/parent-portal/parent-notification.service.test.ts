import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ParentNotificationService, pairId } from './parent-notification.service';
import { FeatureService } from '@/features/feature.service';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const NOW = new Date('2026-11-09T12:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('ParentNotificationService', () => {
  let prisma: MockPrisma;
  let mail: { send: ReturnType<typeof mock> };
  let push: { sendToUsers: ReturnType<typeof mock> };
  let submissions: { listForStudent: ReturnType<typeof mock> };
  let service: ParentNotificationService;
  let org: Record<string, boolean>;
  let disabled: string[];
  let parentSettings: Record<string, unknown>;
  let pref: { email_enabled: boolean; push_enabled: boolean; kinds: string[] };

  beforeEach(() => {
    prisma = createMockPrisma();
    org = { parent_portal: true, parent_notifications: true };
    disabled = [];
    parentSettings = {};
    pref = {
      email_enabled: true,
      push_enabled: true,
      kinds: ['missing_work', 'absence', 'new_grade', 'announcement'],
    };
    prisma.organisation.findFirst.mockImplementation(async () => ({ features: org }));
    prisma.school.findUnique.mockImplementation(async () => ({ disabled_feature_rows: disabled.map((feature) => ({ feature })) }));
    prisma.parent_notification_pref.findMany.mockImplementation(async () => [
      {
        user_profile_id: 'p1',
        email_enabled: pref.email_enabled,
        push_enabled: pref.push_enabled,
        kind_preferences: pref.kinds.map((kind) => ({ kind })),
      },
    ]);
    prisma.parent_student_link.findMany.mockImplementation(async () => [
      {
        user_profile_id: 'p1',
        student: {
          id: 'stu-1',
          first_name: 'Ada',
          last_name: 'L',
          is_active: true,
          date_of_birth: null,
          school_id: 'school-1',
          school: { parent_settings: parentSettings, is_active: true },
        },
      },
    ]);
    prisma.submission.findMany.mockResolvedValue([
      { id: 'sub-1', activity: { title: 'Quiz 1', course: { name: 'Maths' } } },
    ]);
    prisma.course_attendance_record.findMany.mockResolvedValue([
      { id: 'rec-1', course: { name: 'Maths' }, attendance_session: { opened_at: new Date(NOW.getTime() - HOUR) } },
    ]);
    prisma.course_student.findMany.mockResolvedValue([{ course_id: 'c1' }]);
    // Course posts by course_id; school posts (course_id null) by audience.
    prisma.announcement.findMany.mockImplementation(async ({ where }: any) =>
      where.course_id === null
        ? where.audience === 'everyone' && where.school_id === 'school-1'
          ? [{ id: 'sch-1', title: 'Sports day', school: { name: 'Hill' } }]
          : []
        : [{ id: 'ann-1', title: 'Trip', course: { name: 'Maths' } }],
    );
    prisma.user_profile.findMany.mockResolvedValue([{ id: 'p1', email: 'mum@example.com' }]);
    prisma.student.findMany.mockResolvedValue([{ id: 'stu-1', school_id: 'school-1' }]);
    prisma.parent_notification_sent.createManyAndReturn.mockImplementation(async ({ data }: any) =>
      data.map((d: any) => ({ user_profile_id: d.user_profile_id, kind: d.kind, ref_id: d.ref_id })),
    );
    mail = { send: mock(async () => undefined) };
    push = { sendToUsers: mock(async () => undefined) };
    submissions = {
      listForStudent: mock(async () => [
        {
          id: 'act-1', courseId: 'c1', courseName: 'Maths', kind: 'assignment', title: 'Essay', points: 10,
          effectiveDueAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), hasExtension: false, submission: null,
        },
        {
          // An extension moved this child's date into the future: not missing.
          id: 'act-2', courseId: 'c1', courseName: 'Maths', kind: 'assignment', title: 'Late', points: 10,
          effectiveDueAt: new Date(NOW.getTime() + 2 * HOUR).toISOString(), hasExtension: true, submission: null,
        },
      ]),
    };
    const features = new FeatureService(prisma as any, createMockCacheService() as any);
    service = new ParentNotificationService(prisma as any, features, mail as any, push as any, submissions as any);
  });

  test('collects each kind for an opted-in parent with both features on', async () => {
    const notices = await service.collect(NOW);
    expect(notices.map((n) => [n.kind, n.refId]).sort()).toEqual(
      [
        ['absence', 'rec-1'],
        ['announcement', 'ann-1'],
        ['announcement', 'sch-1'],
        ['missing_work', pairId('act-1', 'stu-1')],
        ['new_grade', 'sub-1'],
      ].sort(),
    );
    // Only the child's own rows are read.
    expect(prisma.submission.findMany.mock.calls[0][0].where.student_id).toBe('stu-1');
    expect(prisma.course_attendance_record.findMany.mock.calls[0][0].where.student_id).toBe('stu-1');
  });

  test("school announcements: only the child's school, only audience everyone", async () => {
    const notices = await service.collect(NOW);
    const school = notices.find((n) => n.refId === 'sch-1');
    expect(school).toMatchObject({ kind: 'announcement', title: 'New announcement from Hill', body: 'Sports day' });
    const call = prisma.announcement.findMany.mock.calls
      .map((c: any) => c[0].where)
      .find((w: any) => w.course_id === null);
    expect(call).toMatchObject({ school_id: 'school-1', course_id: null, audience: 'everyone' });
  });

  test('school announcements respect showAnnouncements, the announcements feature and the opt-in', async () => {
    for (const setup of [
      () => (parentSettings = { showAnnouncements: false }),
      () => (disabled = ['announcements']),
      () => (pref.kinds = ['absence']),
    ]) {
      parentSettings = {};
      disabled = [];
      pref.kinds = ['missing_work', 'absence', 'new_grade', 'announcement'];
      setup();
      prisma.announcement.findMany.mockClear();
      service = new ParentNotificationService(
        prisma as any,
        new FeatureService(prisma as any, createMockCacheService() as any),
        mail as any,
        push as any,
        submissions as any,
      );
      const notices = await service.collect(NOW);
      expect(notices.some((n) => n.kind === 'announcement')).toBe(false);
      expect(prisma.announcement.findMany).not.toHaveBeenCalled();
    }
  });

  test('siblings at one school: one school-announcement notice per parent', async () => {
    const kid = (id: string) => ({
      user_profile_id: 'p1',
      student: {
        id, first_name: id, last_name: 'L', is_active: true, date_of_birth: null,
        school_id: 'school-1', school: { parent_settings: {}, is_active: true },
      },
    });
    prisma.parent_student_link.findMany.mockResolvedValue([kid('stu-1'), kid('stu-2')]);
    const notices = await service.collect(NOW);
    expect(notices.filter((n) => n.refId === 'sch-1')).toHaveLength(1);
    // School posts are read once per school per sweep.
    const schoolCalls = prisma.announcement.findMany.mock.calls.filter(
      (c: any) => c[0].where.course_id === null,
    );
    expect(schoolCalls).toHaveLength(1);
  });

  test('nothing with parent_notifications off', async () => {
    org = { parent_portal: true, parent_notifications: false };
    expect(await service.collect(NOW)).toEqual([]);
  });

  test('nothing with parent_portal off (parent_notifications requires it)', async () => {
    org = { parent_portal: false, parent_notifications: true };
    expect(await service.collect(NOW)).toEqual([]);
  });

  test('nothing when the school switched either off', async () => {
    for (const off of [['parent_portal'], ['parent_notifications']]) {
      disabled = off;
      service = new ParentNotificationService(
        prisma as any,
        new FeatureService(prisma as any, createMockCacheService() as any),
        mail as any,
        push as any,
        submissions as any,
      );
      expect(await service.collect(NOW)).toEqual([]);
    }
  });

  test('no grade notices while the school hides grades; no absences while it hides attendance', async () => {
    parentSettings = { showGrades: false, showAttendance: false };
    const kinds = (await service.collect(NOW)).map((n) => n.kind);
    expect(kinds).not.toContain('new_grade');
    expect(kinds).not.toContain('absence');
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
  });

  test('only the kinds the parent picked', async () => {
    pref.kinds = ['absence'];
    const kinds = (await service.collect(NOW)).map((n) => n.kind);
    expect(kinds).toEqual(['absence']);
  });

  test('nobody opted in: nothing is read', async () => {
    prisma.parent_notification_pref.findMany.mockResolvedValue([]);
    expect(await service.collect(NOW)).toEqual([]);
    expect(prisma.parent_student_link.findMany).not.toHaveBeenCalled();
  });

  test('sweep sends only notices not sent before', async () => {
    prisma.parent_notification_sent.createManyAndReturn.mockResolvedValue([
      { user_profile_id: 'p1', kind: 'new_grade', ref_id: 'sub-1' },
    ]);
    const sent = await service.sweep(NOW);
    expect(sent).toBe(1);
    expect(prisma.parent_notification_sent.createManyAndReturn.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect((push.sendToUsers.mock.calls[0] as any)[1].data.type).toBe('parent.new_grade');
    // A child's news: the parent category (own settings), sensitive, the child's school decides the content.
    expect((push.sendToUsers.mock.calls[0] as any)[1]).toMatchObject({ category: 'parent', sensitive: true });
    expect((push.sendToUsers.mock.calls[0] as any)[1].schoolId).toBeTruthy();
    expect(mail.send).toHaveBeenCalledTimes(1);
    // The mail log gets a kind, never the subject (which names the child).
    expect((mail.send.mock.calls[0] as any)[0].kind).toBe('parent_notice');
  });

  test('email and push follow the parent switches', async () => {
    pref = { ...pref, email_enabled: false, push_enabled: true };
    prisma.parent_notification_pref.findMany.mockResolvedValue([{
      user_profile_id: 'p1',
      email_enabled: pref.email_enabled,
      push_enabled: pref.push_enabled,
      kind_preferences: pref.kinds.map((kind) => ({ kind })),
    }] as any);
    await service.sweep(NOW);
    expect(mail.send).not.toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalled();
  });

  test('no push while the school has push_notifications off', async () => {
    disabled = ['push_notifications'];
    await service.sweep(NOW);
    expect(push.sendToUsers).not.toHaveBeenCalled();
    // More than three notices become one digest email.
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  test('preferences default to off and save', async () => {
    prisma.parent_notification_pref.findUnique.mockResolvedValue(null);
    expect(await service.getPrefs('p1')).toEqual({
      emailEnabled: false,
      pushEnabled: false,
      kinds: ['missing_work', 'absence', 'new_grade', 'announcement', 'attendance_alert'],
    });
    await service.setPrefs('p1', { emailEnabled: true, kinds: ['absence', 'absence'] });
    const call = prisma.parent_notification_pref.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ user_profile_id: 'p1' });
    expect(call.create).toMatchObject({
      user_profile_id: 'p1',
      email_enabled: true,
      kind_preferences: { create: [{ kind: 'absence' }] },
    });
    expect(prisma.parent_notification_kind.createMany).toHaveBeenCalledWith({
      data: [{ user_profile_id: 'p1', kind: 'absence' }],
    });
  });

  describe('attendance alerts (attendance_alerts feature)', () => {
    const fresh = () =>
      new ParentNotificationService(
        prisma as any,
        new FeatureService(prisma as any, createMockCacheService() as any),
        mail as any,
        push as any,
        submissions as any,
      );
    beforeEach(() => {
      org = { parent_portal: true, parent_notifications: true, attendance_alerts: true };
      pref.kinds = ['attendance_alert'];
      prisma.attendance_alert_setting.findUnique.mockResolvedValue({ notify_parents: true });
      prisma.attendance_alert.findMany.mockResolvedValue([
        { id: 'al-1', kind: 'low_rate', value: 82.5, threshold: 90, window_days: 28 },
      ]);
      service = fresh();
    });

    test('an open alert from the lookback becomes one notice keyed by the alert', async () => {
      const notices = await service.collect(NOW);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ kind: 'attendance_alert', refId: 'al-1', title: 'Attendance alert for Ada L' });
      expect(notices[0].body).toContain('82.5%');
      const where = prisma.attendance_alert.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ student_id: 'stu-1', school_id: 'school-1', resolved_at: null });
      expect(where.opened_at.gte.getTime()).toBe(NOW.getTime() - 24 * HOUR);
    });

    test('a re-sent sweep sends nothing again (dedupe on the alert id)', async () => {
      prisma.parent_notification_sent.createManyAndReturn.mockResolvedValueOnce([]);
      expect(await service.sweep(NOW)).toBe(0);
    });

    test('gated by the feature, the opt-in, showAttendance, notify_parents and parent notifications', async () => {
      for (const setup of [
        () => (org = { parent_portal: true, parent_notifications: true }),
        () => (pref.kinds = ['absence']),
        () => (parentSettings = { showAttendance: false }),
        () => prisma.attendance_alert_setting.findUnique.mockResolvedValue({ notify_parents: false }),
        () => (org = { parent_portal: true, parent_notifications: false, attendance_alerts: true }),
        () => (disabled = ['attendance']),
      ]) {
        org = { parent_portal: true, parent_notifications: true, attendance_alerts: true };
        pref.kinds = ['attendance_alert'];
        parentSettings = {};
        disabled = [];
        prisma.attendance_alert_setting.findUnique.mockResolvedValue({ notify_parents: true });
        setup();
        service = fresh();
        const notices = await service.collect(NOW);
        expect(notices.filter((n) => n.kind === 'attendance_alert')).toEqual([]);
      }
    });
  });
});
