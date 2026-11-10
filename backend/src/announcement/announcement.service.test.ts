import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import {
  CreateSchoolAnnouncementDto,
  UpdateSchoolAnnouncementDto,
} from './dto/school-announcement.dto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const ROW = {
  id: 'ann-1',
  school_id: 'school-1',
  course_id: 'course-1',
  author_user_profile_id: 'ta-1',
  title: 'Old',
  body: null,
  created_at: new Date('2026-10-20'),
  updated_at: new Date('2026-10-20'),
  user_profile: null,
};

/** Course access is tested on its own; this stand-in hands back a role. */
function service(
  prisma: MockPrisma,
  role: string | null,
  audit: { record: (...args: any[]) => Promise<void> } = {
    record: async () => undefined,
  },
) {
  const access = {
    require: async () => {
      if (!role) throw new NotFoundException('Course not found');
      return { course: { id: 'course-1', school_id: 'school-1' }, role };
    },
  };
  const cache = { delete: async () => undefined };
  return new AnnouncementService(
    prisma as any,
    cache as any,
    access as any,
    undefined,
    undefined,
    audit as any,
  );
}

function seed(prisma: MockPrisma) {
  prisma.announcement.findFirst.mockResolvedValue({
    author_user_profile_id: 'ta-1',
  });
  prisma.announcement.update.mockResolvedValue({ ...ROW, title: 'New' });
  prisma.announcement.delete.mockResolvedValue(ROW);
  prisma.announcement_read.findMany.mockResolvedValue([]);
}

describe('AnnouncementService course announcements', () => {
  test("a course teacher can edit a TA's announcement", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const out = await service(prisma, 'teacher').updateForCourse(
      'teacher-1',
      'course-1',
      'ann-1',
      { title: 'New' },
    );
    expect(out.title).toBe('New');
    expect(prisma.announcement.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ann-1',
      course_id: 'course-1',
    });

  });

  test("a course teacher can delete a TA's announcement", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    await service(prisma, 'teacher').deleteForCourse(
      'teacher-1',
      'course-1',
      'ann-1',
    );
    expect(prisma.announcement.delete).toHaveBeenCalled();
  });

  test('a TA edits their own announcement', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    await service(prisma, 'ta').updateForCourse('ta-1', 'course-1', 'ann-1', {
      title: 'New',
    });
    expect(prisma.announcement.update).toHaveBeenCalled();
  });

  test("a TA cannot change another TA's announcement", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const err = await expectRejection(
      service(prisma, 'ta').deleteForCourse('ta-2', 'course-1', 'ann-1'),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(prisma.announcement.delete).not.toHaveBeenCalled();
  });

  test('an announcement from another course is a 404', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.announcement.findFirst.mockResolvedValue(null);
    const err = await expectRejection(
      service(prisma, 'teacher').updateForCourse(
        'teacher-1',
        'course-1',
        'ann-1',
        { title: 'New' },
      ),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('someone with no course role is a 404', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const err = await expectRejection(
      service(prisma, null).deleteForCourse('x', 'course-1', 'ann-1'),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe('AnnouncementService school announcements audit', () => {
  test('records create, update and delete in the write transactions', async () => {
    const prisma = createMockPrisma();
    const calls: any[][] = [];
    const audit = {
      record: async (...args: any[]) => {
        calls.push(args);
      },
    };
    const schoolAnnouncement = { ...ROW, course_id: null };
    prisma.user_profile.findUnique.mockResolvedValue({
      school_id: 'school-1',
      role: 'admin',
    });
    prisma.announcement.findFirst.mockResolvedValue(schoolAnnouncement);
    prisma.announcement.create.mockResolvedValue(schoolAnnouncement);
    prisma.announcement.update.mockResolvedValue({
      ...schoolAnnouncement,
      title: 'New',
    });
    prisma.announcement.delete.mockResolvedValue(schoolAnnouncement);

    const svc = service(prisma, 'admin', audit);
    await svc.create('admin-1', { title: 'Old' } as any);
    await svc.update('admin-1', 'ann-1', { title: 'New' });
    await svc.delete('admin-1', 'ann-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(calls.map((call) => call[3].action)).toEqual([
      'create',
      'update',
      'delete',
    ]);
    expect(calls.map((call) => call[3].entity)).toEqual([
      'announcement',
      'announcement',
      'announcement',
    ]);
    expect(calls[0][1]).toBe('school-1');
    expect(calls[0][2]).toEqual({ id: 'admin-1' });
    expect(calls[1][3].changes.title).toEqual({
      before: 'Old',
      after: 'New',
    });
    for (const call of calls) expect(call[0]).toBe(prisma);
  });
});

/** A tiny stand-in for the announcement table that applies `where`. */
const TABLE = [
  { id: 'staff-1', school_id: 'school-1', course_id: null, audience: 'staff' },
  { id: 'all-1', school_id: 'school-1', course_id: null, audience: 'everyone' },
  { id: 'course-1', school_id: 'school-1', course_id: 'c1', audience: 'staff' },
  { id: 'all-2', school_id: 'school-2', course_id: null, audience: 'everyone' },
].map((r) => ({
  ...r,
  author_user_profile_id: 'staff-author',
  title: r.id,
  body: null,
  created_at: new Date('2026-11-01'),
  updated_at: null,
  user_profile: { first_name: 'A', last_name: 'B', avatar_url: null },
}));

function filtered(where: Record<string, unknown>) {
  return TABLE.filter((r) =>
    Object.entries(where).every(
      ([k, v]) => (r as Record<string, unknown>)[k] === v,
    ),
  );
}

describe('AnnouncementService audiences', () => {
  function withNotices(prisma: MockPrisma) {
    const notices = { schoolAnnouncementPosted: mock(async () => undefined) };
    const svc = new AnnouncementService(
      prisma as any,
      { delete: async () => undefined, get: async () => null, set: async () => undefined } as any,
      {} as any,
      notices as any,
      undefined,
      { record: async () => undefined } as any,
    );
    return { svc, notices };
  }

  test('the migration defaults every existing row to staff', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261114100000_announcement_audience/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain("CREATE TYPE public.announcement_audience AS ENUM ('staff', 'everyone')");
    expect(sql).toMatch(
      /ADD COLUMN audience public\.announcement_audience NOT NULL DEFAULT 'staff'/,
    );
  });

  test('students and parents get only everyone posts of the given school', async () => {
    const prisma = createMockPrisma();
    prisma.announcement.findMany.mockImplementation(async ({ where }: any) =>
      filtered(where),
    );
    const { svc } = withNotices(prisma);

    const one = await svc.findEveryoneForSchool('school-1');
    expect(one.map((a) => a.id)).toEqual(['all-1']);
    const two = await svc.findEveryoneForSchool('school-2');
    expect(two.map((a) => a.id)).toEqual(['all-2']);
    expect(prisma.announcement.findMany.mock.calls[0][0].where).toEqual({
      school_id: 'school-1',
      course_id: null,
      audience: 'everyone',
    });
    // No read receipts, internal author id or audience in the public shape.
    expect(Object.keys(one[0]).sort()).toEqual(
      ['author', 'body', 'created_at', 'id', 'title', 'updated_at'].sort(),
    );
  });

  test('create defaults to staff and does not notify students', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', role: 'admin' });
    prisma.announcement.create.mockImplementation(async ({ data }: any) => ({
      ...TABLE[0],
      ...data,
      id: 'new',
    }));
    const { svc, notices } = withNotices(prisma);
    const out = await svc.create('admin-1', { title: 'Staff meeting' });
    expect(prisma.announcement.create.mock.calls[0][0].data.audience).toBe('staff');
    expect(out.audience).toBe('staff');
    expect(notices.schoolAnnouncementPosted).not.toHaveBeenCalled();
  });

  test('an everyone post notifies the school once', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', role: 'admin' });
    prisma.announcement.create.mockImplementation(async ({ data }: any) => ({
      ...TABLE[0],
      ...data,
      id: 'new',
    }));
    const { svc, notices } = withNotices(prisma);
    await svc.create('admin-1', { title: 'Sports day', audience: 'everyone' });
    expect(notices.schoolAnnouncementPosted).toHaveBeenCalledTimes(1);
    expect((notices.schoolAnnouncementPosted.mock.calls[0] as any)[0]).toBe('school-1');
  });

  test('widening staff to everyone notifies and is audited; other edits do not notify', async () => {
    const prisma = createMockPrisma();
    const calls: any[] = [];
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', role: 'admin' });
    let current = { ...TABLE[0] };
    prisma.announcement.findFirst.mockImplementation(async () => current);
    prisma.announcement.update.mockImplementation(async ({ data }: any) => {
      current = { ...current, ...data };
      return current;
    });
    prisma.announcement_read.findMany.mockResolvedValue([]);
    const notices = { schoolAnnouncementPosted: mock(async () => undefined) };
    const svc = new AnnouncementService(
      prisma as any,
      { delete: async () => undefined } as any,
      {} as any,
      notices as any,
      undefined,
      { record: async (...a: any[]) => void calls.push(a) } as any,
    );

    await svc.update('admin-1', 'staff-1', { audience: 'everyone' });
    expect(notices.schoolAnnouncementPosted).toHaveBeenCalledTimes(1);
    expect(calls[0][3].changes.audience).toEqual({ before: 'staff', after: 'everyone' });

    // Already everyone: a title edit sends nothing new.
    await svc.update('admin-1', 'staff-1', { title: 'Renamed' });
    expect(notices.schoolAnnouncementPosted).toHaveBeenCalledTimes(1);

    // Narrowing back to staff is audited and sends nothing.
    await svc.update('admin-1', 'staff-1', { audience: 'staff' });
    expect(notices.schoolAnnouncementPosted).toHaveBeenCalledTimes(1);
    expect(calls[2][3].changes.audience).toEqual({ before: 'everyone', after: 'staff' });
  });
});

describe('announcement audience validation', () => {
  const check = async (cls: any, body: Record<string, unknown>) =>
    validate(plainToInstance(cls, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  test('school posts accept staff and everyone only', async () => {
    expect(await check(CreateSchoolAnnouncementDto, { title: 'x', audience: 'everyone' })).toHaveLength(0);
    expect(await check(CreateSchoolAnnouncementDto, { title: 'x' })).toHaveLength(0);
    expect(await check(CreateSchoolAnnouncementDto, { title: 'x', audience: 'parents' })).not.toHaveLength(0);
    expect(await check(UpdateSchoolAnnouncementDto, { audience: 'staff' })).toHaveLength(0);
    expect(await check(UpdateSchoolAnnouncementDto, { audience: 'all' })).not.toHaveLength(0);
  });

  test('course posts take no audience', async () => {
    expect(await check(CreateAnnouncementDto, { title: 'x', audience: 'everyone' })).not.toHaveLength(0);
  });
});
