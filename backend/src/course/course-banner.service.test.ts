import { describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CourseAccessService } from './access/course-access.service';
import { CourseBannerService } from './course-banner.service';
import { COURSE_BANNER_COLORS } from './course-appearance';
import { CourseService } from './course.service';
import { UpdateCourseDto } from './dto/course.dto';
import { ImagesService } from '@/images/images.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const USER = 'user-1';
const COURSE = '11111111-1111-4111-8111-111111111111';
const OLD = `course-banners/${COURSE}-${'b'.repeat(32)}.jpg`;

function courseRow(over: Record<string, any> = {}) {
  return {
    id: COURSE,
    school_id: 'school-1',
    academic_year_id: null,
    term_id: null,
    name: 'Maths',
    code: 'MAT',
    description: null,
    status: 'published',
    join_code: null,
    grade_scale_id: null,
    banner_color: null,
    banner_image_path: null,
    created_by: USER,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

function db(opts: {
  schoolRole?: 'admin' | 'teacher' | 'member' | null;
  courseRole?: 'teacher' | 'ta' | null;
  course?: Record<string, any>;
}): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.school_management.findFirst.mockResolvedValue(
    opts.schoolRole === null
      ? null
      : { role: opts.schoolRole ?? 'teacher', school_management_role: [] },
  );
  prisma.course_staff.findUnique.mockResolvedValue(
    opts.courseRole ? { role: opts.courseRole } : null,
  );
  prisma.course.findUnique.mockResolvedValue(courseRow(opts.course));
  prisma.course.update.mockResolvedValue({ id: COURSE });
  prisma.course_student.groupBy.mockResolvedValue([]);
  return prisma;
}

function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16, 1),
  ]);
}

function makeStorage(stored: { bytes: Buffer; type: string } | null) {
  return {
    put: mock((..._args: any[]) => Promise.resolve()),
    delete: mock((..._args: any[]) => Promise.resolve()),
    exists: mock((..._args: any[]) =>
      Promise.resolve(
        stored ? { size: stored.bytes.byteLength, contentType: stored.type } : null,
      ),
    ),
    getBuffer: mock((..._args: any[]) => Promise.resolve(stored?.bytes ?? null)),
    uploadUrl: mock((key: string, ..._rest: any[]) =>
      Promise.resolve(`https://s3.test/${key}?sig`),
    ),
  };
}

function setup(
  prisma: MockPrisma,
  stored: { bytes: Buffer; type: string } | null = {
    bytes: pngBytes(),
    type: 'image/png',
  },
) {
  const cache = createMockCacheService() as any;
  const access = new CourseAccessService(cache, prisma as any);
  const courses = new CourseService(
    cache,
    access,
    prisma as any,
    createMockErasureLog() as any,
  );
  const storage = makeStorage(stored);
  const images = new ImagesService(storage as any, prisma as any, cache);
  return {
    storage,
    svc: new CourseBannerService(access, courses, images, prisma as any),
  };
}

describe('UpdateCourseDto.bannerColor', () => {
  const check = async (body: unknown) =>
    validate(plainToInstance(UpdateCourseDto, body));

  test('accepts every palette key and null (auto)', async () => {
    for (const bannerColor of COURSE_BANNER_COLORS) {
      expect(await check({ bannerColor })).toHaveLength(0);
    }
    expect(await check({ bannerColor: null })).toHaveLength(0);
  });

  test('rejects anything else', async () => {
    for (const bannerColor of ['purple', '#ff0000', 'auto', 3, '']) {
      expect(await check({ bannerColor })).not.toHaveLength(0);
    }
  });
});

describe('CourseService banner fields', () => {
  test('courses carry the colour and the cover URL, null when unset', async () => {
    const plain = setup(db({ courseRole: 'teacher' }));
    const none = await (plain.svc as any).courses.get(USER, COURSE);
    expect(none.bannerColor).toBeNull();
    expect(none.bannerImageUrl).toBeNull();

    const styled = setup(
      db({
        courseRole: 'teacher',
        course: { banner_color: 'rose', banner_image_path: OLD },
      }),
    );
    const got = await (styled.svc as any).courses.get(USER, COURSE);
    expect(got.bannerColor).toBe('rose');
    expect(got.bannerImageUrl).toEndWith(`/images/${OLD}`);
  });

  test('PATCH stores the colour; null returns to auto', async () => {
    const prisma = db({ courseRole: 'teacher' });
    prisma.course.update.mockResolvedValue(courseRow({ banner_color: 'teal' }));
    const { svc } = setup(prisma);
    const res = await (svc as any).courses.update(USER, COURSE, {
      bannerColor: 'teal',
    });
    expect(prisma.course.update.mock.calls[0][0].data.banner_color).toBe('teal');
    expect(res.bannerColor).toBe('teal');

    await (svc as any).courses.update(USER, COURSE, { bannerColor: null });
    expect(prisma.course.update.mock.calls[1][0].data.banner_color).toBeNull();
  });
});

describe('CourseBannerService', () => {
  test('a ticket stages a random key under uploads/course-banners', async () => {
    const { svc, storage } = setup(db({ courseRole: 'teacher' }));
    const ticket = await svc.createTicket(USER, COURSE, 'image/png', 1024);

    expect(ticket.path).toMatch(
      new RegExp(`^uploads/course-banners/${COURSE}-[0-9a-f]{32}\\.png$`),
    );
    expect(ticket.method).toBe('PUT');
    expect(ticket.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(storage.uploadUrl.mock.calls[0]).toEqual([
      `images/${ticket.path}`,
      'image/png',
      300,
      1024,
    ]);
  });

  test('a ticket refuses non-images, SVG and files over 5 MB', async () => {
    const { svc } = setup(db({ courseRole: 'teacher' }));
    for (const type of ['application/pdf', 'image/svg+xml', 'text/html']) {
      expect(
        await expectRejection(svc.createTicket(USER, COURSE, type, 1024)),
      ).toBeInstanceOf(BadRequestException);
    }
    expect(
      await expectRejection(
        svc.createTicket(USER, COURSE, 'image/png', 5 * 1024 * 1024 + 1),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('a TA is forbidden and a non-member (student, other teacher) sees no course', async () => {
    const ta = setup(db({ courseRole: 'ta' }));
    expect(
      await expectRejection(ta.svc.createTicket(USER, COURSE, 'image/png', 10)),
    ).toBeInstanceOf(ForbiddenException);

    const other = setup(db({ courseRole: null }));
    expect(
      await expectRejection(other.svc.createTicket(USER, COURSE, 'image/png', 10)),
    ).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(other.svc.remove(USER, COURSE))).toBeInstanceOf(
      NotFoundException,
    );

    const student = setup(db({ schoolRole: null }));
    expect(
      await expectRejection(
        student.svc.complete(USER, COURSE, `uploads/course-banners/${COURSE}-${'a'.repeat(32)}.png`),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a school admin with course:update may set it without teaching', async () => {
    const { svc } = setup(db({ schoolRole: 'admin', courseRole: null }));
    const ticket = await svc.createTicket(USER, COURSE, 'image/webp', 10);
    expect(ticket.path).toEndWith('.webp');
  });

  test('complete verifies, serves, points the course at it and deletes the old cover', async () => {
    const prisma = db({ courseRole: 'teacher', course: { banner_image_path: OLD } });
    const { svc, storage } = setup(prisma);
    const path = `uploads/course-banners/${COURSE}-${'a'.repeat(32)}.png`;
    const served = path.slice('uploads/'.length);

    await svc.complete(USER, COURSE, path);

    expect(storage.put.mock.calls[0][0]).toBe(`images/${served}`);
    expect(prisma.course.update.mock.calls[0][0].data.banner_image_path).toBe(
      served,
    );
    const deleted = storage.delete.mock.calls.map((c: any[]) => c[0]);
    expect(deleted).toContain(`images/${path}`);
    expect(deleted).toContain(`images/${OLD}`);
  });

  test('complete refuses another course’s staging key or a served key', async () => {
    const { svc, storage } = setup(db({ courseRole: 'teacher' }));
    const otherCourse = '22222222-2222-4222-8222-222222222222';
    for (const path of [
      `uploads/course-banners/${otherCourse}-${'a'.repeat(32)}.png`,
      `course-banners/${COURSE}-${'a'.repeat(32)}.png`,
      `uploads/avatars/${USER}.png`,
      `uploads/course-banners/${COURSE}-../../x.png`,
    ]) {
      expect(await expectRejection(svc.complete(USER, COURSE, path))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(storage.put).not.toHaveBeenCalled();
  });

  test('complete rejects content that is not the declared image, and deletes it', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const { svc, storage } = setup(prisma, {
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      type: 'image/png',
    });
    const path = `uploads/course-banners/${COURSE}-${'a'.repeat(32)}.png`;
    expect(await expectRejection(svc.complete(USER, COURSE, path))).toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete.mock.calls[0][0]).toBe(`images/${path}`);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  test('complete rejects an oversized object', async () => {
    const { svc, storage } = setup(db({ courseRole: 'teacher' }), {
      bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      type: 'image/png',
    });
    const path = `uploads/course-banners/${COURSE}-${'a'.repeat(32)}.png`;
    expect(await expectRejection(svc.complete(USER, COURSE, path))).toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  test('remove clears the path and deletes the object', async () => {
    const prisma = db({ courseRole: 'teacher', course: { banner_image_path: OLD } });
    const { svc, storage } = setup(prisma);
    await svc.remove(USER, COURSE);

    expect(prisma.course.update.mock.calls[0][0].data.banner_image_path).toBeNull();
    expect(storage.delete.mock.calls[0][0]).toBe(`images/${OLD}`);
  });

  test('remove with no cover touches nothing', async () => {
    const prisma = db({ courseRole: 'teacher' });
    const { svc, storage } = setup(prisma);
    await svc.remove(USER, COURSE);
    expect(prisma.course.update).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
