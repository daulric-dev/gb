import { describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { CourseAccessService } from '../access/course-access.service';
import { CourseService } from '../course.service';
import { CourseFileCopyService } from '../course-file-copy.service';
import type { CourseSnapshot } from '../course-snapshot';
import { LibraryService, previewOf, type LibraryContent } from './library.service';
import { LibraryImportService } from './library-import.service';

const AUTHOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const IMPORTER = 'bbbbbbbb-0000-4000-8000-000000000002';
const SCHOOL_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const SCHOOL_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const AUTHOR_FILE = '44444444-4444-4444-8444-444444444444';
const PAGE = '55555555-5555-4555-8555-555555555555';

function course(id: string, schoolId: string) {
  return {
    id,
    school_id: schoolId,
    academic_year_id: null,
    term_id: null,
    name: 'Biology',
    code: null,
    description: 'Cells',
    status: 'draft',
    join_code: null,
    grade_scale_id: null,
    is_template: false,
    banner_color: null,
    banner_image_path: null,
    created_by: AUTHOR,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
  };
}

/** A database where `user` works in `school` with `role`, teaching SOURCE / TARGET. */
function db(opts: {
  school?: string;
  role?: 'admin' | 'teacher' | 'member' | null;
  courseRole?: 'teacher' | 'ta' | null;
}): MockPrisma {
  const prisma = createMockPrisma();
  const school = opts.school ?? SCHOOL_A;
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: school });
  prisma.school_management.findFirst.mockResolvedValue(
    opts.role === null ? null : { role: opts.role ?? 'teacher', school_management_role: [] },
  );
  prisma.course.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === SOURCE ? course(SOURCE, SCHOOL_A) : where.id === TARGET ? course(TARGET, school) : null,
  );
  prisma.course_staff.findUnique.mockImplementation(async () =>
    opts.courseRole === null ? null : { role: opts.courseRole ?? 'teacher' },
  );
  // The source course: one module with a page and a file item.
  const bySource = (rows: any[]) => async ({ where }: any) => (where.course_id === SOURCE ? rows : []);
  prisma.page.findMany.mockImplementation(bySource([{ id: PAGE, title: 'Intro', body: `See file ${AUTHOR_FILE}`, is_published: true }]));
  prisma.module.findMany.mockImplementation(bySource([{ id: 'm1', title: 'Week 1', position: 0, is_published: true }]));
  prisma.module_item.findMany.mockImplementation(
    bySource([
      { module_id: 'm1', position: 0, item_type: 'page', title: null, page_id: PAGE, activity_id: null, file_id: null, discussion_topic_id: null, url: null, indent: 0, is_published: true, lti_resource_link: null },
      { module_id: 'm1', position: 1, item_type: 'file', title: 'Notes', page_id: null, activity_id: null, file_id: AUTHOR_FILE, discussion_topic_id: null, url: null, indent: 0, is_published: true, lti_resource_link: null },
    ]),
  );
  prisma.file.findMany.mockImplementation(async ({ where }: any) =>
    where.status === 'ready' && where.id?.in?.includes(AUTHOR_FILE)
      ? [{ id: AUTHOR_FILE, name: 'Notes.pdf', content_type: 'application/pdf', size_bytes: 2048n, bucket: 'file-manager', storage_path: `${SCHOOL_A}/${AUTHOR}/${AUTHOR_FILE}-notes.pdf` }]
      : [],
  );
  return prisma;
}

function storageMock() {
  return { copy: mock(async () => undefined), delete: mock(async () => undefined) };
}

function services(prisma: MockPrisma, storage = storageMock(), limitMb = 100) {
  const cache = createMockCacheService() as any;
  const access = new CourseAccessService(cache, prisma as any);
  const courses = new CourseService(cache, access, prisma as any, createMockErasureLog() as any);
  const limits = { forSchool: async () => ({ uploadLimitBytes: limitMb * 1024 * 1024, uploadLimitMb: limitMb }) };
  const features = { isEnabled: async () => true };
  const files = new CourseFileCopyService(prisma as any, storage as any, limits as any, features as any);
  const library = new LibraryService(prisma as any, cache, access, storage as any);
  const imports = new LibraryImportService(prisma as any, cache, access, courses, files, library);
  imports.inlineBackoffMs = 0;
  return { library, imports, storage };
}

/** A stored version as publishing writes it: files point at library keys. */
function content(over: Partial<LibraryContent> = {}): LibraryContent {
  const snap: CourseSnapshot = {
    v: 1,
    sourceCourseId: SOURCE,
    description: 'Cells',
    bannerColor: null,
    discussion: null,
    groups: [],
    rubrics: [],
    banks: [],
    activities: [],
    pages: [{ id: PAGE, title: 'Intro', body: `See file ${AUTHOR_FILE}`, isPublished: true }],
    modules: [{ id: 'm1', title: 'Week 1', position: 0, isPublished: true }],
    items: [
      { moduleId: 'm1', position: 0, itemType: 'page', title: null, pageId: PAGE, activityId: null, fileId: null, topicId: null, url: null, indent: 0, isPublished: true, externalTool: null },
      { moduleId: 'm1', position: 1, itemType: 'file', title: 'Notes', pageId: null, activityId: null, fileId: AUTHOR_FILE, topicId: null, url: null, indent: 0, isPublished: true, externalTool: null },
    ],
    topics: [],
    files: [{ id: AUTHOR_FILE, name: 'Notes.pdf', contentType: 'application/pdf', sizeBytes: 2048, bucket: 'course-library', path: `${ITEM}/v1/${AUTHOR_FILE}-notes.pdf` }],
  };
  return { ...snap, selection: null, ...over };
}

function itemRow(over: Record<string, any> = {}) {
  return {
    id: ITEM,
    school_id: SCHOOL_A,
    source_course_id: SOURCE,
    title: 'Cells unit',
    description: null,
    subject: 'Biology',
    grade_level: '9',
    tags: [{ tag: 'cells' }],
    visibility: 'school',
    latest_version: 1,
    created_by: AUTHOR,
    unpublished_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    school: { name: 'School A' },
    user_profile: { first_name: 'Ada', last_name: 'Author' },
    ...over,
  };
}

const created = (prisma: MockPrisma, model: string) =>
  prisma[model].createMany.mock.calls.flatMap((c: any[]) => c[0].data);

describe('publishing', () => {
  test('copies linked files into library storage; the version never points at the author\'s file', async () => {
    const prisma = db({});
    prisma.library_item.findUnique.mockResolvedValue(itemRow());
    prisma.library_item_version.findUnique.mockImplementation(async () => ({ version: 1, content: content() }));
    const { library, storage } = services(prisma);

    await library.publish(AUTHOR, { sourceCourseId: SOURCE, title: ' Cells unit ', tags: ['Cells', 'cells'] });

    const item = prisma.library_item.create.mock.calls[0][0].data;
    expect(item).toMatchObject({
      school_id: SCHOOL_A,
      title: 'Cells unit',
      tags: { create: [{ tag: 'cells' }] },
      visibility: 'school',
      latest_version: 1,
    });
    const version = prisma.library_item_version.create.mock.calls[0][0].data;
    expect(version.version).toBe(1);
    const [file] = version.content.files;
    expect(file.bucket).toBe('course-library');
    expect(file.path.startsWith(`${item.id}/${version.id}/`)).toBe(true);
    expect(storage.copy).toHaveBeenCalledWith(
      `file-manager/${SCHOOL_A}/${AUTHOR}/${AUTHOR_FILE}-notes.pdf`,
      `course-library/${file.path}`,
      'application/pdf',
    );
    // The author's storage key is nowhere in the stored content.
    expect(JSON.stringify(version.content)).not.toContain(`${SCHOOL_A}/${AUTHOR}/`);
  });

  test('organisation-wide sharing needs course-library:create', async () => {
    const prisma = db({ role: 'teacher' });
    const { library } = services(prisma);
    const err = await expectRejection(
      library.publish(AUTHOR, { sourceCourseId: SOURCE, title: 'X', visibility: 'organisation' }),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(prisma.library_item.create).not.toHaveBeenCalled();
  });

  test('a school admin may share with the organisation', async () => {
    const prisma = db({ role: 'admin' });
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ visibility: 'organisation' }));
    prisma.library_item_version.findUnique.mockResolvedValue({ version: 1, content: content() });
    const { library } = services(prisma);
    await library.publish(AUTHOR, { sourceCourseId: SOURCE, title: 'X', visibility: 'organisation' });
    expect(prisma.library_item.create.mock.calls[0][0].data.visibility).toBe('organisation');
  });

  test('a TA cannot publish the course', async () => {
    const prisma = db({ courseRole: 'ta' });
    const err = await expectRejection(services(prisma).library.publish(AUTHOR, { sourceCourseId: SOURCE, title: 'X' }));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('a selection publishes only the chosen parts and what they need', async () => {
    const prisma = db({});
    prisma.library_item.findUnique.mockResolvedValue(itemRow());
    prisma.library_item_version.findUnique.mockResolvedValue({ version: 1, content: content() });
    const { library } = services(prisma);
    await library.publish(AUTHOR, { sourceCourseId: SOURCE, title: 'Just a page', selection: { pageIds: [PAGE] } });
    const stored = prisma.library_item_version.create.mock.calls[0][0].data.content;
    expect(stored.modules).toEqual([]);
    expect(stored.pages.map((p: any) => p.id)).toEqual([PAGE]);
    expect(stored.files).toEqual([]);
    expect(stored.selection).toEqual({ pageIds: [PAGE] });
  });

  test('a failed version write removes the copied objects', async () => {
    const prisma = db({});
    prisma.library_item_version.create.mockRejectedValue(new Error('boom'));
    const storage = storageMock();
    const { library } = services(prisma, storage);
    const err = await expectRejection(library.publish(AUTHOR, { sourceCourseId: SOURCE, title: 'X' }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(storage.delete).toHaveBeenCalled();
  });
});

describe('versioning', () => {
  test('republishing makes the next version, keeps the earlier one and the previous selection, and relists', async () => {
    const prisma = db({});
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ latest_version: 1, unpublished_at: new Date() }));
    prisma.library_item.update.mockResolvedValue({ latest_version: 2 });
    prisma.library_item_version.findUnique.mockResolvedValue({ version: 1, content: content({ selection: { pageIds: [PAGE] } }) });
    const { library } = services(prisma);

    await library.republish(AUTHOR, ITEM, {});

    expect(prisma.library_item.update.mock.calls[0][0].data).toMatchObject({
      latest_version: { increment: 1 },
      unpublished_at: null,
    });
    const v2 = prisma.library_item_version.create.mock.calls[0][0].data;
    expect(v2.version).toBe(2);
    expect(v2.content.selection).toEqual({ pageIds: [PAGE] });
    // Nothing deletes or rewrites version 1.
    expect(prisma.library_item_version.update).not.toHaveBeenCalled();
    expect(prisma.library_item_version.deleteMany).not.toHaveBeenCalled();
  });

  test('only the publisher or a school admin can republish or unpublish', async () => {
    const prisma = db({ role: 'teacher' });
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ created_by: 'someone-else' }));
    const { library } = services(prisma);
    expect(await expectRejection(library.unpublish(AUTHOR, ITEM))).toBeInstanceOf(ForbiddenException);
    expect(await expectRejection(library.republish(AUTHOR, ITEM, {}))).toBeInstanceOf(ForbiddenException);
  });

  test('unpublishing hides the item but deletes nothing', async () => {
    const prisma = db({});
    prisma.library_item.findUnique.mockResolvedValue(itemRow());
    const { library } = services(prisma);
    await library.unpublish(AUTHOR, ITEM);
    expect(prisma.library_item.update.mock.calls[0][0].data.unpublished_at).toBeInstanceOf(Date);
    expect(prisma.library_item.delete).not.toHaveBeenCalled();
    expect(prisma.library_import.updateMany).not.toHaveBeenCalled();
  });
});

describe('visibility', () => {
  test('browsing matches only published items of your school or shared with the organisation', async () => {
    const prisma = db({ school: SCHOOL_B });
    const { library } = services(prisma);
    await library.browse(IMPORTER, {});
    const where = prisma.library_item.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({
      unpublished_at: null,
      OR: [{ school_id: SCHOOL_B }, { visibility: 'organisation' }],
    });
  });

  test("another school's school-only item reads as not found", async () => {
    const prisma = db({ school: SCHOOL_B });
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ visibility: 'school' }));
    const err = await expectRejection(services(prisma).library.get(IMPORTER, ITEM));
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test("another school's organisation item can be previewed", async () => {
    const prisma = db({ school: SCHOOL_B });
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ visibility: 'organisation' }));
    prisma.library_item_version.findUnique.mockResolvedValue({ version: 1, content: content() });
    const detail = await services(prisma).library.get(IMPORTER, ITEM);
    expect(detail.preview.modules[0].items.map((i: any) => i.title)).toEqual(['Intro', 'Notes']);
    expect(detail.sourceCourseId).toBeNull();
    expect(detail.canManage).toBe(false);
    // The preview never exposes where the bytes are.
    expect(JSON.stringify(detail.preview)).not.toContain('course-library');
  });

  test('an unpublished item is hidden from everyone but its managers', async () => {
    const prisma = db({ school: SCHOOL_A });
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ unpublished_at: new Date(), created_by: 'someone-else' }));
    const err = await expectRejection(services(prisma).library.get(IMPORTER, ITEM));
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('students and people without a school membership are refused', async () => {
    const prisma = db({ role: null });
    const err = await expectRejection(services(prisma).library.browse(IMPORTER, {}));
    expect(err).toBeInstanceOf(ForbiddenException);
  });
});

describe('importing', () => {
  function importDb(over: { status?: string; school?: string; mode?: string } = {}) {
    const prisma = db({ school: over.school ?? SCHOOL_B });
    prisma.library_item.findUnique.mockResolvedValue(itemRow({ visibility: 'organisation' }));
    prisma.library_item_version.findUnique.mockResolvedValue({ id: 'ver-1', version: 1, content: content(), file_count: 1, file_bytes: 2048n });
    const row = {
      id: 'imp-1',
      version_id: 'ver-1',
      school_id: over.school ?? SCHOOL_B,
      requested_by: IMPORTER,
      mode: over.mode ?? 'append',
      target_course_id: over.mode === 'new_course' ? null : TARGET,
      options: over.mode === 'new_course' ? { shift: 0, newCourse: { name: 'Bio 2027' } } : { shift: 0 },
      status: over.status ?? 'queued',
      files_total: 1,
      files_done: 0,
      result: null,
      notes: [],
      error: null,
      attempts: 0,
      created_at: new Date(),
      updated_at: new Date(),
      finished_at: null,
      version: { version: 1, content: content(), item: { id: ITEM, title: 'Cells unit', source_course_id: SOURCE } },
    };
    prisma.library_import.create.mockResolvedValue(row);
    prisma.library_import.findUnique.mockResolvedValue(row);
    prisma.$queryRaw.mockResolvedValue([{ status: 'copying' }]);
    prisma.course.create.mockResolvedValue({ id: 'new-course' });
    return prisma;
  }

  test('files are copied to new keys owned by the importer in their school; the author\'s file is never referenced', async () => {
    const prisma = importDb();
    const storage = storageMock();
    const { imports } = services(prisma, storage);
    expect(await imports.run('imp-1', { final: true })).toBe('done');

    const [file] = created(prisma, 'file');
    expect(file).toMatchObject({ owner_id: IMPORTER, school_id: SCHOOL_B, bucket: 'file-manager', status: 'pending' });
    expect(file.id).not.toBe(AUTHOR_FILE);
    expect(file.storage_path).toBe(`${SCHOOL_B}/${IMPORTER}/${file.id}-notes.pdf`);
    expect(storage.copy).toHaveBeenCalledWith(
      `course-library/${ITEM}/v1/${AUTHOR_FILE}-notes.pdf`,
      `file-manager/${SCHOOL_B}/${IMPORTER}/${file.id}-notes.pdf`,
      'application/pdf',
    );
    const items = created(prisma, 'module_item');
    expect(items.find((i: any) => i.item_type === 'file').file_id).toBe(file.id);
    // Page text that linked the author's file now links the importer's copy.
    expect(created(prisma, 'page')[0].body).toBe(`See file ${file.id}`);
    const writes = JSON.stringify(
      ['module_item', 'page', 'activity', 'module'].flatMap((m) => created(prisma, m)),
    );
    expect(writes).not.toContain(AUTHOR_FILE);
    expect(prisma.file_share.createMany).not.toHaveBeenCalled();
    const done = prisma.library_import.update.mock.calls.at(-1)![0].data;
    expect(done.status).toBe('done');
    expect(prisma.file.updateMany.mock.calls.at(-1)![0].data.status).toBe('ready');
  });

  test('a file over the school upload limit fails before anything is written', async () => {
    const prisma = importDb();
    const storage = storageMock();
    const { imports } = services(prisma, storage, 0.001);
    const err = await expectRejection(imports.start(IMPORTER, ITEM, { targetCourseId: TARGET }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('Notes.pdf');
    expect(prisma.library_import.create).not.toHaveBeenCalled();
    expect(prisma.file.createMany).not.toHaveBeenCalled();
    expect(storage.copy).not.toHaveBeenCalled();
  });

  test('start records the import and runs it in the background', async () => {
    const prisma = importDb();
    const { imports } = services(prisma);
    const out = await imports.start(IMPORTER, ITEM, { targetCourseId: TARGET });
    expect(out.status).toBe('queued');
    expect(prisma.library_import.create.mock.calls[0][0].data).toMatchObject({ mode: 'append', target_course_id: TARGET, files_total: 1, school_id: SCHOOL_B });
    await imports.inflight;
    expect(prisma.module.createMany).toHaveBeenCalled();
  });

  test('a new course needs course:create', async () => {
    const prisma = importDb();
    prisma.school_management.findFirst.mockResolvedValue({ role: 'member', school_management_role: [] });
    const err = await expectRejection(services(prisma).imports.start(IMPORTER, ITEM, { newCourse: { name: 'X' } }));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('importing into a course you only assist is refused', async () => {
    const prisma = importDb();
    prisma.course_staff.findUnique.mockResolvedValue({ role: 'ta' });
    const err = await expectRejection(services(prisma).imports.start(IMPORTER, ITEM, { targetCourseId: TARGET }));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('outcome alignments still on the source course are carried onto the imported copies', async () => {
    const prisma = importDb();
    prisma.outcome_alignment.findMany.mockImplementation(async ({ where }: any) =>
      where.course_id === SOURCE
        ? [{ outcome_id: 'school-outcome', activity_id: null, criterion_id: null, question_id: null, outcome: { course_id: null, school_id: SCHOOL_A } }]
        : [],
    );
    await services(prisma).imports.run('imp-1', { final: true });
    expect(prisma.outcome_alignment.findMany.mock.calls[0][0].where).toEqual({ course_id: SOURCE });
    // Another school's school-level outcome is never linked into this school.
    expect(prisma.outcome_alignment.createMany).not.toHaveBeenCalled();
  });

  test('a new-course import creates a draft course the importer teaches', async () => {
    const prisma = importDb({ mode: 'new_course' });
    await services(prisma).imports.run('imp-1', { final: true });
    expect(prisma.course.create.mock.calls[0][0].data).toMatchObject({ school_id: SCHOOL_B, name: 'Bio 2027', created_by: IMPORTER });
    expect(prisma.course_staff.create.mock.calls[0][0].data).toEqual({ course_id: 'new-course', user_profile_id: IMPORTER, role: 'teacher' });
  });

  test('is idempotent: a finished import is not run again, and a racing run writes nothing', async () => {
    const done = importDb({ status: 'done' });
    expect(await services(done).imports.run('imp-1', { final: true })).toBe('skipped');
    expect(done.file.createMany).not.toHaveBeenCalled();

    const racing = importDb();
    racing.$queryRaw.mockResolvedValue([{ status: 'done' }]);
    expect(await services(racing).imports.run('imp-1', { final: true })).toBe('skipped');
    expect(racing.module.createMany).not.toHaveBeenCalled();
  });

  test('a resumed run reserves the same file ids', async () => {
    const a = importDb();
    await services(a).imports.run('imp-1', { final: true });
    const b = importDb();
    await services(b).imports.run('imp-1', { final: true });
    expect(created(a, 'file')[0].id).toBe(created(b, 'file')[0].id);
    expect(b.file.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  test('a failed final attempt marks the import failed and discards copied files', async () => {
    const prisma = importDb();
    prisma.module.createMany.mockRejectedValue(new Error('boom'));
    const storage = storageMock();
    prisma.file.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'pending' ? [{ id: where.id.in[0], bucket: 'file-manager', storage_path: 'x' }] : [],
    );
    expect(await services(prisma, storage).imports.run('imp-1', { final: true })).toBe('failed');
    expect(prisma.library_import.updateMany.mock.calls[0][0].data.status).toBe('failed');
    expect(storage.delete).toHaveBeenCalled();
  });

  test('an external tool is skipped with a note when the school cannot use it', async () => {
    const prisma = importDb();
    const c = content({
      items: [
        ...content().items,
        { moduleId: 'm1', position: 2, itemType: 'external_tool', title: 'Lab sim', pageId: null, activityId: null, fileId: null, topicId: null, url: null, indent: 0, isPublished: true, externalTool: { toolId: 'tool-1', customParams: {} } },
      ],
    });
    prisma.library_import.findUnique.mockResolvedValue({ ...(await prisma.library_import.findUnique()), version: { version: 1, content: c, item: { id: ITEM, title: 'x', source_course_id: null } } });
    prisma.lti_tool.findMany.mockResolvedValue([{ id: 'tool-1', name: 'PhET', enabled: true, deployments: [] }]);
    await services(prisma).imports.run('imp-1', { final: true });
    expect(created(prisma, 'module_item').some((i: any) => i.item_type === 'external_tool')).toBe(false);
    expect(prisma.lti_resource_link.createMany).not.toHaveBeenCalled();
    const done = prisma.library_import.update.mock.calls.at(-1)![0].data;
    expect(done.notes.join(' ')).toContain('PhET');
  });

  test('an external tool deployed to the school is copied with that school\'s deployment', async () => {
    const prisma = importDb();
    const c = content({
      items: [
        { moduleId: 'm1', position: 0, itemType: 'external_tool', title: 'Lab sim', pageId: null, activityId: null, fileId: null, topicId: null, url: null, indent: 0, isPublished: true, externalTool: { toolId: 'tool-1', customParams: { level: '2' } } },
      ],
      files: [],
    });
    prisma.library_import.findUnique.mockResolvedValue({ ...(await prisma.library_import.findUnique()), files_total: 0, version: { version: 1, content: c, item: { id: ITEM, title: 'x', source_course_id: null } } });
    prisma.lti_tool.findMany.mockResolvedValue([{ id: 'tool-1', name: 'PhET', enabled: true, deployments: [{ id: 'dep-b', school_id: SCHOOL_B }] }]);
    await services(prisma).imports.run('imp-1', { final: true });
    const [link] = created(prisma, 'lti_resource_link');
    expect(link).toMatchObject({ tool_id: 'tool-1', deployment_id: 'dep-b', course_id: TARGET, custom_params: { level: '2' } });
  });

  test('excluded data is never read or written', async () => {
    const prisma = importDb();
    await services(prisma).imports.run('imp-1', { final: true });
    for (const model of [
      'submission',
      'course_student',
      'course_attendance_record',
      'activity_extension',
      'activity_accommodation',
      'student_accommodation',
      'rubric_assessment',
      'peer_review_allocation',
      'lti_deployment',
    ]) {
      expect(prisma[model].findMany).not.toHaveBeenCalled();
      expect(prisma[model].createMany).not.toHaveBeenCalled();
    }
  });

  test('status is only for the person who started the import', async () => {
    const prisma = importDb();
    const err = await expectRejection(services(prisma).imports.status(AUTHOR, 'imp-1'));
    expect(err).toBeInstanceOf(NotFoundException);
  });
});

describe('previewOf', () => {
  test('resolves item titles and leaves out storage keys', () => {
    const p = previewOf(content());
    expect(p.counts.files).toBe(1);
    expect(p.files).toEqual([{ name: 'Notes.pdf', contentType: 'application/pdf', sizeBytes: 2048 }]);
  });
});
