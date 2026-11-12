import { describe, expect, mock, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { RetentionService } from '@/retention/retention.service';
import { PastoralService } from './pastoral.service';
import { canChangeNote, canSeeNote, visibleNotes, type PastoralCaller } from './pastoral-access';
import { isSealedText, openText, sealText } from '@/account/sensitive-text';

const SCHOOL = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER_SCHOOL = 'bbbbbbbb-2222-4222-8222-222222222222';
const STUDENT = 'cccccccc-3333-4333-8333-333333333333';
const NOTE = 'dddddddd-4444-4444-8444-444444444444';
const SG_NOTE = 'eeeeeeee-5555-4555-8555-555555555555';
const CAT = 'ffffffff-6666-4666-8666-666666666666';
const SG_CAT = '99999999-7777-4777-8777-777777777777';

// Staff of SCHOOL and what their roles grant.
const USERS: Record<string, { role: string; keys: string[]; school?: string } | null> = {
  admin: { role: 'admin', keys: [] },
  lead: { role: 'member', keys: ['pastoral-note:read', 'pastoral-note:create', 'pastoral-note:update'] },
  dsl: {
    role: 'member',
    keys: ['pastoral-note:read', 'pastoral-note:create', 'pastoral-note:update', 'pastoral-note:safeguarding'],
  },
  teacher: { role: 'teacher', keys: [] },
  author: { role: 'teacher', keys: [] },
  member: { role: 'member', keys: [] },
  outsider: { role: 'admin', keys: [], school: OTHER_SCHOOL },
  student: null,
};

function note(over: Record<string, any> = {}) {
  return {
    id: NOTE,
    school_id: SCHOOL,
    student_id: STUDENT,
    category_id: CAT,
    is_safeguarding: false,
    severity: 'low',
    occurred_on: new Date('2026-11-01T00:00:00Z'),
    body: 'Helped a classmate',
    follow_up_on: null,
    assigned_to: null,
    status: 'open',
    resolved_at: null,
    resolved_by: null,
    author_id: 'author',
    created_at: new Date(),
    updated_at: new Date(),
    category: { label: 'Pastoral', kind: 'pastoral' },
    student: { first_name: 'Sam', last_name: 'Student', student_number: '42' },
    author: { first_name: 'Al', last_name: 'Author' },
    assignee: null,
    files: [],
    ...over,
  };
}
const sgNote = (over: Record<string, any> = {}) =>
  note({ id: SG_NOTE, category_id: SG_CAT, is_safeguarding: true, author_id: 'dsl', category: { label: 'Safeguarding', kind: 'safeguarding' }, ...over });

function db(): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockImplementation(async ({ where }: any) => {
    const u = USERS[where.id];
    return { school_id: u === null ? SCHOOL : (u?.school ?? SCHOOL) };
  });
  prisma.school_management.findFirst.mockImplementation(async ({ where }: any) => {
    const u = USERS[where.user_id];
    if (!u || (u.school ?? SCHOOL) !== where.school_id) return null;
    return {
      role: u.role,
      school_management_role: [
        { school_role: { school_role_permission: u.keys.map((key) => ({ permission_catalog: { key } })) } },
      ],
    };
  });
  prisma.student.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === STUDENT && where.school_id === SCHOOL ? { id: STUDENT } : null,
  );
  prisma.pastoral_category.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.school_id !== SCHOOL) return null;
    if (where.id === CAT) return { id: CAT, school_id: SCHOOL, kind: 'pastoral', is_safeguarding: false, archived_at: null };
    if (where.id === SG_CAT) return { id: SG_CAT, school_id: SCHOOL, kind: 'safeguarding', is_safeguarding: true, archived_at: null };
    return null;
  });
  prisma.pastoral_note.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === NOTE ? note() : where.id === SG_NOTE ? sgNote() : null,
  );
  prisma.pastoral_note.create.mockResolvedValue({ id: NOTE });
  prisma.organisation_admin.findUnique.mockResolvedValue(null);
  return prisma;
}

function service(prisma: MockPrisma) {
  const cache = createMockCacheService() as any;
  const audit = new AuditLogService(prisma as any, cache);
  const erasure = { record: mock(async () => undefined) };
  const files = { readContentForAuthorisedCaller: mock(async () => ({ body: 'x', size: 1, contentType: 'text/plain', filename: 'a.txt' })) };
  return { svc: new PastoralService(prisma as any, cache, audit, erasure as any, files as any), erasure, files };
}

const auditRows = (prisma: MockPrisma) => prisma.audit_log.create.mock.calls.map((c: any[]) => c[0].data);

describe('permission matrix', () => {
  const caller = (over: Partial<PastoralCaller>): PastoralCaller => ({
    userId: 'u', schoolId: SCHOOL, read: false, create: false, update: false, safeguarding: false, admin: false, ...over,
  });
  const plain = { school_id: SCHOOL, author_id: 'someone', is_safeguarding: false };
  const sg = { school_id: SCHOOL, author_id: 'someone', is_safeguarding: true };
  const own = { school_id: SCHOOL, author_id: 'u', is_safeguarding: false };

  test.each([
    ['nothing', {}, [false, false, true]],
    ['read', { read: true }, [true, false, true]],
    ['read + safeguarding', { read: true, safeguarding: true }, [true, true, true]],
    ['safeguarding alone', { safeguarding: true }, [false, false, true]],
    ['create', { create: true }, [false, false, true]],
  ] as const)('%s sees plain / safeguarding / own notes as expected', (_n, keys, [p, s, o]) => {
    const c = caller(keys as Partial<PastoralCaller>);
    expect(canSeeNote(c, plain)).toBe(p);
    expect(canSeeNote(c, sg)).toBe(s);
    expect(canSeeNote(c, own)).toBe(o);
  });

  test('changing needs update (or authorship with create), and safeguarding for safeguarding notes', () => {
    expect(canChangeNote(caller({ read: true }), plain)).toBe(false);
    expect(canChangeNote(caller({ read: true, update: true }), plain)).toBe(true);
    expect(canChangeNote(caller({ read: true, update: true }), sg)).toBe(false);
    expect(canChangeNote(caller({ read: true, update: true, safeguarding: true }), sg)).toBe(true);
    expect(canChangeNote(caller({ create: true }), own)).toBe(true);
    expect(canChangeNote(caller({}), own)).toBe(false);
  });

  test('a note of another school is never visible, whatever the keys', () => {
    const c = caller({ read: true, safeguarding: true, update: true });
    expect(canSeeNote(c, { ...plain, school_id: OTHER_SCHOOL })).toBe(false);
    expect(canSeeNote(c, { ...own, school_id: OTHER_SCHOOL })).toBe(false);
  });

  test('the list filter is always scoped to the school and hides safeguarding without the key', () => {
    expect(visibleNotes(caller({ read: true }))).toEqual({
      school_id: SCHOOL,
      OR: [{ author_id: 'u' }, { is_safeguarding: false }],
    });
    expect(visibleNotes(caller({}))).toEqual({ school_id: SCHOOL, OR: [{ author_id: 'u' }] });
  });
});

describe('PastoralService', () => {
  test('admins hold every pastoral key except safeguarding, which is never implied', async () => {
    const { svc } = service(db());
    expect(await svc.me('admin')).toEqual({ canRead: true, canCreate: true, canUpdate: true, canSafeguard: false, canManageSettings: true });
    const err = await expectRejection(svc.get('admin', SG_NOTE));
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('note text is stored encrypted against the note id and read back in clear', async () => {
    const prisma = db();
    const { svc } = service(prisma);
    await svc.create('lead', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: ' Private text ' });
    const data = prisma.pastoral_note.create.mock.calls[0][0].data;
    expect(isSealedText(data.body)).toBe(true);
    expect(openText('pastoral_note.body', data.id, data.body)).toBe('Private text');
    // Sealed rows and old plain-text rows both read as text.
    prisma.pastoral_note.findUnique.mockResolvedValue(note({ body: sealText('pastoral_note.body', NOTE, 'Sealed') }));
    expect((await svc.get('lead', NOTE)).body).toBe('Sealed');
    prisma.pastoral_note.findUnique.mockResolvedValue(note({ body: 'Legacy plain' }));
    expect((await svc.get('lead', NOTE)).body).toBe('Legacy plain');
    // A sealed value moved to another row does not open.
    prisma.pastoral_note.findUnique.mockResolvedValue(note({ body: sealText('pastoral_note.body', SG_NOTE, 'Moved') }));
    expect((await svc.get('lead', NOTE)).body).not.toBe('Moved');
  });

  test('a blank note is refused (the column only sees ciphertext)', async () => {
    const err = await expectRejection(
      service(db()).svc.create('lead', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: '   ' }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
  });

  test('a teacher can write a note and see their own, but not read others', async () => {
    const prisma = db();
    const { svc } = service(prisma);
    prisma.pastoral_note.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === NOTE ? note({ author_id: 'teacher' }) : sgNote(),
    );
    await svc.create('teacher', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: ' Kind ' });
    const created = prisma.pastoral_note.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ author_id: 'teacher', is_safeguarding: false });
    expect(openText('pastoral_note.body', created.id, created.body)).toBe('Kind');
    await svc.list('teacher', {});
    expect(prisma.pastoral_note.findMany.mock.calls.at(-1)![0].where.AND[0]).toEqual({
      school_id: SCHOOL,
      OR: [{ author_id: 'teacher' }],
    });
  });

  test('without create, writing is refused', async () => {
    const err = await expectRejection(service(db()).svc.create('member', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: 'x' }));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('a safeguarding note needs the safeguarding key to write; the category is hidden without it', async () => {
    const err = await expectRejection(service(db()).svc.create('lead', STUDENT, { categoryId: SG_CAT, occurredOn: '2026-11-01', body: 'x' }));
    expect(err).toBeInstanceOf(NotFoundException);
    const prisma = db();
    await service(prisma).svc.create('dsl', STUDENT, { categoryId: SG_CAT, occurredOn: '2026-11-01', body: 'x' });
    expect(prisma.pastoral_note.create.mock.calls[0][0].data.is_safeguarding).toBe(true);
  });

  test('a safeguarding note reads as not found without the key, even with read', async () => {
    const err = await expectRejection(service(db()).svc.get('lead', SG_NOTE));
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('every read of a safeguarding note is audit-logged, and never sent to webhooks', async () => {
    const prisma = db();
    prisma.school.findUnique.mockResolvedValue({ name: 'A', disabled_features: [] });
    prisma.organisation.findFirst.mockResolvedValue({ features: { integrations: true } });
    prisma.school_webhook.findMany.mockResolvedValue([{ id: 'hook' }]);
    prisma.pastoral_note.findMany.mockResolvedValue([note(), sgNote()]);
    const { svc } = service(prisma);

    await svc.get('dsl', SG_NOTE);
    await svc.list('dsl', {});
    const reads = auditRows(prisma).filter((r: any) => r.action === 'read');
    // The note opened, the safeguarding note in the list, and the list view.
    expect(reads.filter((r: any) => r.entity_id === SG_NOTE)).toHaveLength(2);
    const view = reads.find((r: any) => r.entity_id === null);
    expect(view.changes.view.after).toBe('list');
    expect(view.changes.note_ids.after).toEqual([NOTE, SG_NOTE]);
    // Nothing about the note text in the audit entry.
    expect(JSON.stringify(reads)).not.toContain('Helped a classmate');
    expect(prisma.webhook_delivery.createMany).not.toHaveBeenCalled();
  });

  test('reading notes of any category is audited: one entry per note opened, one per view', async () => {
    const prisma = db();
    prisma.pastoral_note.findMany.mockResolvedValue([note()]);
    const { svc } = service(prisma);
    await svc.timeline('lead', STUDENT, {});
    await svc.get('lead', NOTE);
    const reads = auditRows(prisma).filter((r: any) => r.action === 'read');
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({ entity: 'pastoral_note', entity_id: STUDENT });
    expect(reads[0].changes.view.after).toBe('timeline');
    expect(reads[1]).toMatchObject({ entity: 'pastoral_note', entity_id: NOTE });
    expect(JSON.stringify(reads)).not.toContain('Helped a classmate');
  });

  test('the export is audited as an export with its row count', async () => {
    const prisma = db();
    prisma.pastoral_note.findMany.mockResolvedValue([note(), note({ id: 'n2' })]);
    await service(prisma).svc.exportCsv('lead', { status: 'open' });
    const exp = auditRows(prisma).find((r: any) => r.action === 'export');
    expect(exp).toMatchObject({ entity: 'pastoral_note', school_id: SCHOOL });
    expect(exp.changes.rows.after).toBe(2);
    expect(exp.changes.scope.after).toBe('school');
    expect(exp.changes.filters.after).toEqual({ status: 'open' });
  });

  test('writes are audited without the note text and without webhooks', async () => {
    const prisma = db();
    prisma.school.findUnique.mockResolvedValue({ name: 'A', disabled_features: [] });
    prisma.organisation.findFirst.mockResolvedValue({ features: { integrations: true } });
    prisma.school_webhook.findMany.mockResolvedValue([{ id: 'hook' }]);
    await service(prisma).svc.create('lead', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: 'Secret text' });
    const [row] = auditRows(prisma);
    expect(row).toMatchObject({ entity: 'pastoral_note', action: 'create' });
    expect(JSON.stringify(row)).not.toContain('Secret text');
    expect(prisma.webhook_delivery.createMany).not.toHaveBeenCalled();
  });

  test('editing needs update; resolving stamps who and when', async () => {
    const prisma = db();
    const { svc } = service(prisma);
    expect(await expectRejection(svc.update('teacher', NOTE, { status: 'resolved' }))).toBeInstanceOf(NotFoundException);
    await svc.update('lead', NOTE, { status: 'resolved', body: 'Changed' });
    const data = prisma.pastoral_note.update.mock.calls[0][0].data;
    expect(data.status).toBe('resolved');
    expect(data.resolved_by).toBe('lead');
    expect(data.resolved_at).toBeInstanceOf(Date);
    const audit = auditRows(prisma).find((r: any) => r.action === 'update');
    expect(audit.changes.text_edited).toEqual({ before: false, after: true });
    expect(JSON.stringify(audit)).not.toContain('Changed');
  });

  test('a follow-up can only go to staff who could read the note', async () => {
    const prisma = db();
    const err = await expectRejection(
      service(prisma).svc.create('dsl', STUDENT, { categoryId: SG_CAT, occurredOn: '2026-11-01', body: 'x', assignedTo: 'lead' }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    await service(prisma).svc.create('dsl', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: 'x', assignedTo: 'lead' });
  });

  test('my follow-ups are the open notes assigned to me', async () => {
    const prisma = db();
    await service(prisma).svc.myFollowUps('lead');
    const where = prisma.pastoral_note.findMany.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({ assigned_to: 'lead', status: 'open' });
  });

  test('only your own files can be attached', async () => {
    const prisma = db();
    prisma.file.findMany.mockResolvedValue([]);
    const err = await expectRejection(
      service(prisma).svc.create('lead', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: 'x', fileIds: ['11111111-1111-4111-8111-111111111111'] }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.file.findMany.mock.calls[0][0].where).toMatchObject({ owner_id: 'lead', school_id: SCHOOL, deleted_at: null });
  });

  test('an attachment is served only through a note the caller can see', async () => {
    const prisma = db();
    const fileId = '12121212-1212-4121-8121-121212121212';
    prisma.pastoral_note.findUnique.mockResolvedValue(
      sgNote({ files: [{ file: { id: fileId, name: 'a.txt', content_type: 'text/plain', size_bytes: 1n, deleted_at: null } }] }),
    );
    const { svc, files } = service(prisma);
    expect(await expectRejection(svc.readFile('lead', SG_NOTE, fileId))).toBeInstanceOf(NotFoundException);
    expect(files.readContentForAuthorisedCaller).not.toHaveBeenCalled();
    await svc.readFile('dsl', SG_NOTE, fileId);
    expect(files.readContentForAuthorisedCaller).toHaveBeenCalledWith(fileId);
    expect(auditRows(prisma).some((r: any) => r.action === 'read')).toBe(true);
  });

  test('deleting is an erasure: logged with the note id only', async () => {
    const prisma = db();
    const { svc, erasure } = service(prisma);
    expect(await expectRejection(svc.remove('lead', SG_NOTE))).toBeInstanceOf(NotFoundException);
    await svc.remove('lead', NOTE);
    expect(prisma.pastoral_note.deleteMany).toHaveBeenCalledWith({ where: { id: NOTE } });
    expect((erasure.record.mock.calls[0] as any[])[1]).toMatchObject({
      kind: 'pastoral_note',
      subjectTable: 'student.pastoral_note',
      subjectIds: [NOTE],
      reason: 'admin',
    });
  });

  test('the CSV export needs read and leaves safeguarding notes out without the key', async () => {
    const prisma = db();
    const { svc } = service(prisma);
    expect(await expectRejection(svc.exportCsv('teacher', {}))).toBeInstanceOf(ForbiddenException);
    prisma.pastoral_note.findMany.mockResolvedValue([note({ body: '=HYPERLINK("x")' })]);
    const out = await svc.exportCsv('lead', {});
    expect(prisma.pastoral_note.findMany.mock.calls[0][0].where.AND[0].OR).toContainEqual({ is_safeguarding: false });
    // Formula injection is neutralised.
    expect(out.csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  test('cross-school: another school\'s student and notes are not found', async () => {
    const prisma = db();
    const { svc } = service(prisma);
    expect(await expectRejection(svc.create('outsider', STUDENT, { categoryId: CAT, occurredOn: '2026-11-01', body: 'x' }))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(svc.get('outsider', NOTE))).toBeInstanceOf(NotFoundException);
    await svc.list('outsider', {});
    expect(prisma.pastoral_note.findMany.mock.calls[0][0].where.AND[0].school_id).toBe(OTHER_SCHOOL);
  });

  test('students and parents are refused outright', async () => {
    const { svc } = service(db());
    for (const call of [
      () => svc.list('student', {}),
      () => svc.get('student', NOTE),
      () => svc.myFollowUps('student'),
      () => svc.exportCsv('student', {}),
      () => svc.categories('student'),
    ]) {
      expect(await expectRejection(call())).toBeInstanceOf(ForbiddenException);
    }
  });

  test('categories: safeguarding ones are hidden without the key; defaults are created once', async () => {
    const prisma = db();
    const { svc } = service(prisma);
    await svc.categories('lead');
    expect(prisma.pastoral_category.createMany.mock.calls[0][0].data.map((d: any) => d.kind)).toEqual([
      'behaviour_positive', 'behaviour_concern', 'pastoral', 'safeguarding', 'medical', 'other',
    ]);
    expect(prisma.pastoral_category.findMany.mock.calls[0][0].where.is_safeguarding).toBe(false);
  });

  test('making a category safeguarding moves its notes with it', async () => {
    const prisma = db();
    await service(prisma).svc.updateCategory('admin', CAT, { isSafeguarding: true });
    expect(prisma.pastoral_note.updateMany).toHaveBeenCalledWith({ where: { category_id: CAT }, data: { is_safeguarding: true } });
  });

  test('only school admins change categories and retention', async () => {
    const { svc } = service(db());
    expect(await expectRejection(svc.updateSettings('dsl', { retentionDays: 365 }))).toBeInstanceOf(ForbiddenException);
    expect(await expectRejection(svc.createCategory('dsl', { label: 'X', kind: 'other' }))).toBeInstanceOf(ForbiddenException);
  });
});

describe('retention', () => {
  test('resolved notes past the school retention are purged and logged as retention_purge', async () => {
    const prisma = createMockPrisma();
    prisma.pastoral_setting.findMany.mockResolvedValue([{ school_id: SCHOOL, retention_days: 365 }]);
    let calls = 0;
    prisma.pastoral_note.findMany.mockImplementation(async () => (calls++ === 0 ? [{ id: NOTE }] : []));
    prisma.pastoral_note.deleteMany.mockResolvedValue({ count: 1 });
    const erasure = { record: mock(async () => undefined), prune: async () => ({ rows: 0, objects: 0 }), exportPending: async () => 0 };
    const storage = { delete: async () => undefined, listKeys: async () => [], listKeysOlderThan: async () => [] };
    const retention = new RetentionService(prisma as any, storage as any, erasure as any, { retryStorage: async () => 0 } as any);
    const now = new Date('2027-12-01T00:00:00Z');

    const report = await retention.purge({ now, only: [NOTE] });

    expect(report.pastoralNotes).toBe(1);
    const where = prisma.pastoral_note.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ school_id: SCHOOL, status: 'resolved' });
    expect(where.resolved_at.lt).toEqual(new Date(now.getTime() - 365 * 86_400_000));
    const entry = erasure.record.mock.calls.find((c: any[]) => c[1].kind === 'pastoral_note') as any[];
    expect(entry[1]).toMatchObject({ subjectIds: [NOTE], reason: 'retention_purge', actor: 'system', schoolId: SCHOOL });
  });

  test('schools without a retention period keep their notes', async () => {
    const prisma = createMockPrisma();
    prisma.pastoral_setting.findMany.mockResolvedValue([]);
    const erasure = { record: mock(async () => undefined), prune: async () => ({ rows: 0, objects: 0 }), exportPending: async () => 0 };
    const retention = new RetentionService(prisma as any, {} as any, erasure as any, {} as any);
    const report = await retention.purge({ dryRun: true, only: [NOTE] });
    expect(report.pastoralNotes).toBe(0);
    expect(prisma.pastoral_setting.findMany.mock.calls[0][0].where).toEqual({ retention_days: { not: null } });
    expect(prisma.pastoral_note.deleteMany).not.toHaveBeenCalled();
  });
});

describe('never exposed outside staff pastoral routes', () => {
  const SRC = join(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
    });

  test.each([
    'student-portal',
    'parent-portal',
    'report-card',
    'integrations',
    'lti',
    'student-account',
  ])('src/%s never touches pastoral notes', (dir) => {
    for (const f of files(join(SRC, dir))) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/pastoral/i);
    }
  });

  test('pastoral, retention purge and staff-only exports query the notes table', () => {
    const touching = files(SRC)
      .filter((f) => !f.includes('/generated/'))
      .filter((f) => /\b(?:prisma|tx|db)\.pastoral_note\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(touching).toEqual([
      'data-export/collectors/staff-only.ts',
      'pastoral/pastoral.service.ts',
      'retention/retention.service.ts',
    ]);
  });

  test('the module exports nothing for other modules to use', () => {
    const mod = readFileSync(join(__dirname, 'pastoral.module.ts'), 'utf8');
    expect(mod).not.toMatch(/exports\s*:/);
  });
});
