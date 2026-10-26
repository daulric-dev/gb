/**
 * Every erasure path writes its erasure-log entry with the transaction
 * client of the erasure itself (so they commit or roll back together), and
 * the entry holds ids only. Each service gets a real ErasureLogService; the
 * Prisma mock hands interactive transactions a separate `tx` mock, so a write
 * on `tx` is a write inside the transaction.
 */
import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createFakeStorage } from '@/test/erasure-mocks';
import { ErasureLogService } from './erasure-log.service';
import { validatePlan } from './erasure-plan';
import { AuthService } from '@/auth/auth.service';
import { StudentMembershipService } from '@/student-account/student-membership.service';
import { SchoolService } from '@/school/school.service';
import { FileManagerService } from '@/file-manager/file-manager.service';
import { FolderService } from '@/file-manager/folder.service';
import { ChatService } from '@/chat/chat.service';
import { DiscussionService } from '@/discussion/discussion.service';
import { CourseService } from '@/course/course.service';
import { AttendanceService } from '@/attendance/attendance.service';

const U = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const USER = U(1);
const OTHER = U(2);
const SCHOOL = U(3);
const SUBJECT = U(4);
const COURSE_ID = U(5);
/** Personal data in the fixtures that must never reach the log. */
const PERSONAL = ['Jane', 'Doe', 'jane@example.com', 'secret message', 'report-card.pdf', 'Riverside'];

function setup() {
  const prisma = createMockPrisma();
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (t: MockPrisma) => unknown)(tx) : Promise.all(arg as unknown[]),
  );
  tx.erasure_log.create.mockResolvedValue({ id: 'log-1' });
  const storage = createFakeStorage();
  const erasure = new ErasureLogService(prisma as any, storage as any);
  return { prisma, tx, storage, erasure };
}

/** The one entry written, checked for shape and for personal data. */
function loggedEntry(prisma: MockPrisma, tx: MockPrisma) {
  expect(prisma.erasure_log.create).not.toHaveBeenCalled();
  expect(tx.erasure_log.create).toHaveBeenCalledTimes(1);
  const { data } = tx.erasure_log.create.mock.calls[0][0];
  validatePlan(data.replay);
  const text = JSON.stringify(data);
  for (const p of PERSONAL) expect(text).not.toContain(p);
  return data;
}

/** Make the log insert fail: the erasure must fail with it. */
const failLog = (tx: MockPrisma) => tx.erasure_log.create.mockRejectedValue(new Error('log insert failed'));

describe('DELETE /api/auth/account', () => {
  function build() {
    const s = setup();
    const cache = createMockCacheService();
    const sessions = { revokeAll: mock(async () => undefined) };
    s.prisma.file.findMany.mockResolvedValue([
      { school_id: SCHOOL, bucket: 'file-manager', storage_path: `${SCHOOL}/${USER}/${SUBJECT}-report-card.pdf` },
    ]);
    s.prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
    s.storage.objects.set(`file-manager/${SCHOOL}/${USER}/${SUBJECT}-report-card.pdf`, Buffer.from('x'));
    s.storage.objects.set(`images/avatars/${USER}.png`, Buffer.from('x'));
    const svc = new AuthService(s.prisma as any, cache as any, {} as any, {} as any, {} as any, sessions as any, s.erasure);
    return { ...s, svc, cache };
  }

  test('profile, account and log entry in one transaction; objects after commit', async () => {
    const { prisma, tx, storage, svc } = build();
    await svc.deleteAccount(USER);
    expect(tx.user_profile.deleteMany.mock.calls[0][0]).toEqual({ where: { id: USER } });
    expect(tx.app_user.deleteMany.mock.calls[0][0]).toEqual({ where: { id: USER } });
    expect(prisma.app_user.deleteMany).not.toHaveBeenCalled();
    const data = loggedEntry(prisma, tx);
    expect(data).toMatchObject({ kind: 'account', subject_ids: [USER], actor: USER, reason: 'user_request', school_id: SCHOOL });
    expect(data.replay.steps[0]).toEqual({
      op: 'delete_storage_prefix',
      prefixes: [`file-manager/${SCHOOL}/${USER}/`, `images/avatars/${USER}.`],
    });
    expect(storage.objects.size).toBe(0);
  });

  test('a failed log write fails the deletion and leaves storage alone', async () => {
    const { tx, storage, svc, cache } = build();
    await cache.set(`profile:${USER}`, { id: USER }, 1);
    failLog(tx);
    await expectRejection(svc.deleteAccount(USER));
    expect(storage.objects.size).toBe(2);
    expect(await cache.get(`profile:${USER}`)).not.toBeNull();
  });
});

describe('student merge', () => {
  function build() {
    const s = setup();
    s.prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
    s.prisma.student.findUnique.mockResolvedValue({ user_profile_id: OTHER });
    s.tx.$queryRaw.mockResolvedValue([{ student_id: U(9) }]);
    const svc = new StudentMembershipService(s.prisma as any, createMockCacheService() as any, s.erasure);
    return { ...s, svc };
  }

  test('the merge function and the log entry share a transaction', async () => {
    const { prisma, tx, svc } = build();
    await svc.mergeDuplicate(USER, SUBJECT, U(9));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const data = loggedEntry(prisma, tx);
    expect(data).toMatchObject({ kind: 'student', reason: 'merge', subject_ids: [SUBJECT] });
    expect(data.replay.steps.map((s: any) => s.op)).toEqual(['update', 'update', 'delete']);
  });

  test('rolls back with a failed log write', async () => {
    const { tx, svc } = build();
    failLog(tx);
    await expectRejection(svc.mergeDuplicate(USER, SUBJECT, U(9)));
  });
});

describe('removing someone from a school', () => {
  function build() {
    const s = setup();
    s.prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
    s.prisma.school_management.findUnique.mockResolvedValue({ id: SUBJECT, user_id: OTHER, school_id: SCHOOL, role: 'teacher' });
    s.prisma.school.findUnique.mockResolvedValue({ owner_id: USER });
    const svc = new SchoolService(s.prisma as any, createMockCacheService() as any, s.erasure, {} as any);
    return { ...s, svc };
  }

  test('membership, detach and log entry in one transaction', async () => {
    const { prisma, tx, svc } = build();
    await svc.removeMember(USER, SUBJECT);
    expect(tx.school_management.deleteMany.mock.calls[0][0]).toEqual({ where: { id: SUBJECT } });
    expect(tx.user_profile.updateMany).toHaveBeenCalled();
    expect(loggedEntry(prisma, tx)).toMatchObject({ kind: 'school_membership', reason: 'admin', actor: USER });
  });

  test('rolls back with a failed log write', async () => {
    const { tx, svc } = build();
    failLog(tx);
    await expectRejection(svc.removeMember(USER, SUBJECT));
  });

  test('leaving a school logs the user\'s own request', async () => {
    const s = setup();
    s.prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, role: 'teacher' });
    s.prisma.school.findUnique.mockResolvedValue({ owner_id: OTHER });
    s.tx.school_management.findMany.mockResolvedValue([{ id: SUBJECT }]);
    const svc = new SchoolService(s.prisma as any, createMockCacheService() as any, s.erasure, {} as any);
    await svc.leaveSchool(USER);
    expect(loggedEntry(s.prisma, s.tx)).toMatchObject({ kind: 'school_membership', reason: 'user_request', subject_ids: [SUBJECT] });
  });
});

describe('file and folder delete', () => {
  test('a file soft delete is logged in its transaction', async () => {
    const s = setup();
    s.prisma.file.findFirst.mockResolvedValue({ id: SUBJECT, owner_id: USER, school_id: SCHOOL, name: 'report-card.pdf' });
    const svc = new FileManagerService(s.storage as any, s.prisma as any, {} as any, {} as any, {} as any, {} as any, s.erasure);
    await svc.softDelete(USER, SUBJECT);
    expect(s.tx.file.updateMany.mock.calls[0][0].where).toEqual({ id: SUBJECT });
    expect(loggedEntry(s.prisma, s.tx)).toMatchObject({ kind: 'file', subject_ids: [SUBJECT], school_id: SCHOOL });

    const f = setup();
    f.prisma.file.findFirst.mockResolvedValue({ id: SUBJECT, owner_id: USER, school_id: SCHOOL });
    failLog(f.tx);
    const svc2 = new FileManagerService(f.storage as any, f.prisma as any, {} as any, {} as any, {} as any, {} as any, f.erasure);
    await expectRejection(svc2.softDelete(USER, SUBJECT));
  });

  test('a folder delete logs the subtree with its files', async () => {
    const s = setup();
    s.prisma.folder.findFirst.mockResolvedValue({ id: SUBJECT, owner_id: USER, school_id: SCHOOL, name: 'Jane' });
    s.prisma.folder.findMany.mockResolvedValueOnce([{ id: U(6) }]).mockResolvedValue([]);
    const svc = new FolderService(s.prisma as any, s.erasure);
    await svc.remove(USER, SUBJECT);
    const data = loggedEntry(s.prisma, s.tx);
    expect(data).toMatchObject({ kind: 'folder', subject_ids: [SUBJECT, U(6)] });
    expect(data.replay.steps[0].where).toEqual({ owner_id: [USER], folder_id: [SUBJECT, U(6)] });
  });
});

describe('chat message delete', () => {
  function build() {
    const s = setup();
    s.prisma.message.findUnique.mockResolvedValue({ id: SUBJECT, sender_id: USER, conversation_id: U(7), body: 'x', metadata: {} });
    s.tx.message.update.mockResolvedValue({ id: SUBJECT, sender_id: USER, conversation_id: U(7), school_id: SCHOOL, body: null, metadata: {}, deleted_at: new Date() });
    const cipher = { decrypt: (v: string) => v, encrypt: (v: string) => v };
    const realtime = { publish: mock(async () => undefined), publishToConversation: mock(async () => undefined) };
    const svc = new ChatService(s.prisma as any, realtime as any, cipher as any, s.erasure);
    (svc as any).fanOutMessage = mock(async () => undefined);
    return { ...s, svc };
  }

  test('the blanking update and the log entry share a transaction', async () => {
    const { prisma, tx, svc } = build();
    await svc.deleteMessage(USER, SUBJECT);
    expect(tx.message.update.mock.calls[0][0].data).toMatchObject({ body: null });
    expect(prisma.message.update).not.toHaveBeenCalled();
    expect(loggedEntry(prisma, tx)).toMatchObject({ kind: 'chat_message', school_id: SCHOOL });
  });

  test('rolls back with a failed log write', async () => {
    const { tx, svc } = build();
    failLog(tx);
    await expectRejection(svc.deleteMessage(USER, SUBJECT));
  });
});

describe('discussions', () => {
  const ctx = (userId = USER) => ({ course: { id: COURSE_ID, school_id: SCHOOL, status: 'published' } as any, userId, role: 'teacher' as const });
  function build() {
    const s = setup();
    s.prisma.discussion_topic.findFirst.mockResolvedValue({ id: SUBJECT, course_id: COURSE_ID, author_user_profile_id: OTHER, title: 'Jane' });
    s.prisma.discussion_reply.findFirst.mockResolvedValue({ id: U(8), parent_id: null, author_user_profile_id: OTHER });
    const svc = new DiscussionService(s.prisma as any, {} as any, s.erasure);
    return { ...s, svc };
  }

  test('a topic delete by a teacher is logged as admin', async () => {
    const { prisma, tx, svc } = build();
    await svc.remove(ctx(), SUBJECT);
    expect(tx.discussion_topic.deleteMany).toHaveBeenCalled();
    expect(loggedEntry(prisma, tx)).toMatchObject({ kind: 'discussion_topic', reason: 'admin' });
  });

  test('a reply with answers is blanked; one without is deleted; both logged', async () => {
    const blank = build();
    blank.tx.discussion_reply.count.mockResolvedValue(2);
    await blank.svc.removeReply(ctx(OTHER), SUBJECT, U(8));
    const data = loggedEntry(blank.prisma, blank.tx);
    expect(data).toMatchObject({ kind: 'discussion_reply', reason: 'user_request' });
    expect(data.replay.steps[0].op).toBe('update');

    const del = build();
    await del.svc.removeReply(ctx(), SUBJECT, U(8));
    expect(del.tx.discussion_reply.deleteMany).toHaveBeenCalled();
    expect(loggedEntry(del.prisma, del.tx).replay.steps[0]).toEqual({
      op: 'delete',
      table: 'course.discussion_reply',
      where: { id: [U(8)] },
    });
  });

  test('rolls back with a failed log write', async () => {
    const { tx, svc } = build();
    failLog(tx);
    await expectRejection(svc.remove(ctx(), SUBJECT));
  });
});

describe('course and attendance session delete', () => {
  const access = { require: async () => ({ course: { id: COURSE_ID, school_id: SCHOOL, status: 'archived' }, role: 'teacher' }) };

  test('a course delete is logged in its transaction', async () => {
    const s = setup();
    const svc = new CourseService(createMockCacheService() as any, access as any, s.prisma as any, s.erasure);
    await svc.remove(USER, COURSE_ID);
    expect(s.tx.course.deleteMany.mock.calls[0][0]).toEqual({ where: { id: COURSE_ID } });
    expect(loggedEntry(s.prisma, s.tx)).toMatchObject({ kind: 'course', subject_ids: [COURSE_ID], reason: 'admin' });

    const f = setup();
    failLog(f.tx);
    const svc2 = new CourseService(createMockCacheService() as any, access as any, f.prisma as any, f.erasure);
    await expectRejection(svc2.remove(USER, COURSE_ID));
  });

  test('an attendance session delete is logged in its transaction', async () => {
    const s = setup();
    s.prisma.attendance_session.findFirst.mockResolvedValue({ id: SUBJECT, course_id: COURSE_ID, opened_at: new Date(0), closes_at: new Date(0), closed_at: new Date(0) });
    const svc = new AttendanceService(s.prisma as any, createMockCacheService() as any, access as any, {} as any, {} as any, s.erasure);
    await svc.remove(USER, COURSE_ID, SUBJECT);
    expect(s.tx.attendance_session.deleteMany).toHaveBeenCalled();
    expect(loggedEntry(s.prisma, s.tx)).toMatchObject({ kind: 'attendance_session', subject_ids: [SUBJECT] });
  });
});
