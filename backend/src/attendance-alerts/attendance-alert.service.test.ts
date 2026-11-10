import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { AttendanceAlertService, DEFAULT_ALERT_SETTINGS, alertEmail } from './attendance-alert.service';

const NOW = new Date('2026-11-09T12:00:00Z');
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
const rec = (student: string, status: string, daysAgo: number) => ({
  student_id: student,
  status,
  attendance_session: { opened_at: at(daysAgo) },
});

describe('AttendanceAlertService', () => {
  let prisma: MockPrisma;
  let records: any[];
  let open: { id: string; student_id: string; kind: string }[];
  let mail: { send: ReturnType<typeof mock> };
  let features: { isEnabled: ReturnType<typeof mock> };
  let service: AttendanceAlertService;
  const settings = { ...DEFAULT_ALERT_SETTINGS, minRate: 90, consecutiveAbsences: 3 };

  beforeEach(() => {
    prisma = createMockPrisma();
    records = [];
    open = [];
    prisma.course_attendance_record.findMany.mockImplementation(async () => records);
    prisma.attendance_alert.findMany.mockImplementation(async () => open);
    // The partial unique index: an open (student, kind) blocks a second insert.
    prisma.attendance_alert.createManyAndReturn.mockImplementation(async ({ data }: any) => {
      const out: any[] = [];
      for (const d of data) {
        if (open.some((o) => o.student_id === d.student_id && o.kind === d.kind)) continue;
        const row = { id: `al-${open.length + 1}`, ...d };
        open.push(row);
        out.push(row);
      }
      return out;
    });
    prisma.attendance_alert.updateMany.mockImplementation(async ({ where }: any) => {
      const before = open.length;
      open = open.filter((o) => !where.id.in.includes(o.id));
      return { count: before - open.length };
    });
    mail = { send: mock(async () => undefined) };
    features = { isEnabled: mock(async () => true) };
    service = new AttendanceAlertService(prisma as any, features as any, mail as any, {} as any);
  });

  const lowRateRecords = () => [
    rec('s1', 'present', 1), rec('s1', 'present', 2), rec('s1', 'absent', 3),
    rec('s1', 'absent', 4), rec('s1', 'present', 5), rec('s1', 'present', 6),
  ];

  test('opens a low-rate alert once and does not repeat it while it holds', async () => {
    records = lowRateRecords();
    const first = await service.sweepSchool('school-1', settings, NOW);
    expect(first.map((a) => [a.student_id, a.kind, a.value])).toEqual([['s1', 'low_rate', 66.7]]);
    const again = await service.sweepSchool('school-1', settings, NOW);
    expect(again).toEqual([]);
    expect(open).toHaveLength(1);
  });

  test('re-alerts only after recovery', async () => {
    records = lowRateRecords();
    await service.sweepSchool('school-1', settings, NOW);
    // Recovered: 10 of 11 attended in the window.
    records = [...lowRateRecords().slice(0, 2), ...Array.from({ length: 9 }, (_, i) => rec('s1', 'present', 7 + i))];
    records = records.filter((r) => r.status !== 'absent');
    records.push(rec('s1', 'absent', 20));
    expect(await service.sweepSchool('school-1', settings, NOW)).toEqual([]);
    expect(open).toHaveLength(0);
    records = lowRateRecords();
    const back = await service.sweepSchool('school-1', settings, NOW);
    expect(back).toHaveLength(1);
  });

  test('records outside the window do not count toward the rate', async () => {
    records = [
      ...Array.from({ length: 5 }, (_, i) => rec('s1', 'absent', 40 + i)),
      ...Array.from({ length: 5 }, (_, i) => rec('s1', 'present', 1 + i)),
    ];
    expect(await service.sweepSchool('school-1', settings, NOW)).toEqual([]);
  });

  test('consecutive absences alert, and resolve when the student attends', async () => {
    records = [rec('s2', 'present', 5), rec('s2', 'absent', 3), rec('s2', 'excused', 2), rec('s2', 'absent', 1), rec('s2', 'absent', 0.5)];
    const opened = await service.sweepSchool('school-1', { ...settings, minRate: null }, NOW);
    expect(opened.map((a) => [a.kind, a.value])).toEqual([['consecutive_absences', 3]]);
    records.push(rec('s2', 'present', 0.1));
    await service.sweepSchool('school-1', { ...settings, minRate: null }, NOW);
    expect(open).toHaveLength(0);
  });

  test('switching a check off resolves its open alerts', async () => {
    records = lowRateRecords();
    await service.sweepSchool('school-1', settings, NOW);
    await service.sweepSchool('school-1', { ...settings, minRate: null }, NOW);
    expect(open).toHaveLength(0);
  });

  test('sweep skips schools with the feature off', async () => {
    prisma.attendance_alert_setting.findMany.mockResolvedValue([
      { school_id: 'school-1', min_rate: 90, window_days: 28, min_sessions: 5, consecutive_absences: null, notify_tutor: true, notify_admins: true, notify_parents: true, email_staff: true },
    ]);
    records = lowRateRecords();
    features.isEnabled.mockResolvedValue(false);
    expect(await service.sweep(NOW)).toBe(0);
    expect(features.isEnabled.mock.calls[0]).toEqual(['school-1', 'attendance_alerts']);
    features.isEnabled.mockResolvedValue(true);
    expect(await service.sweep(NOW)).toBe(1);
  });

  test('emails the form tutor and admins once each; a tutor who left is skipped', async () => {
    prisma.student.findMany.mockResolvedValue([
      { id: 's1', first_name: 'Ada', last_name: 'L', form_tutor_id: 'tutor-1' },
      { id: 's2', first_name: 'Bo', last_name: 'K', form_tutor_id: 'gone' },
    ]);
    prisma.school_management.findMany.mockResolvedValue([
      { user_id: 'tutor-1', role: 'teacher', user_profile: { email: 'tutor@x.test' } },
      { user_id: 'admin-1', role: 'admin', user_profile: { email: 'admin@x.test' } },
    ]);
    prisma.school.findUnique.mockResolvedValue({ name: 'Hill' });
    const alerts = [
      { id: 'a1', school_id: 'school-1', student_id: 's1', kind: 'low_rate', value: 80, threshold: 90, window_days: 28 },
      { id: 'a2', school_id: 'school-1', student_id: 's2', kind: 'consecutive_absences', value: 3, threshold: 3, window_days: null },
    ];
    await service.notifyStaff('school-1', settings, alerts);
    const to = mail.send.mock.calls.map((c: any) => c[0].to).sort();
    expect(to).toEqual(['admin@x.test', 'tutor@x.test']);
    const adminMail = mail.send.mock.calls.find((c: any) => c[0].to === 'admin@x.test')![0];
    expect(adminMail.subject).toBe('2 attendance alerts at Hill');
    mail.send.mockClear();
    await service.notifyStaff('school-1', { ...settings, notifyAdmins: false }, alerts);
    expect(mail.send.mock.calls.map((c: any) => c[0].to)).toEqual(['tutor@x.test']);
    mail.send.mockClear();
    await service.notifyStaff('school-1', { ...settings, emailStaff: false }, alerts);
    expect(mail.send).not.toHaveBeenCalled();
  });

  test('form tutors must be school staff, and students in the school', async () => {
    expect(await expectRejection(service.setFormTutor('school-1', ['s1'], 'stranger'))).toBeInstanceOf(
      BadRequestException,
    );
    prisma.school_management.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.student.updateMany.mockResolvedValue({ count: 1 });
    expect(await expectRejection(service.setFormTutor('school-1', ['s1', 's9'], 'tutor-1'))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.student.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ['s1', 's9'] }, school_id: 'school-1' });
  });

  test('the email names the single student in its subject', () => {
    expect(alertEmail({ schoolName: 'Hill', lines: ['Ada L: x'], url: 'u' }).subject).toBe('Attendance alert: Ada L');
  });
});
