import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ConflictException, ExecutionContext, BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';

const rejected = async (p: Promise<unknown>) => (await expectRejection(p)) as Error;
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { AuthGuard } from '@/auth/auth.guard';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { openSecret } from '@/account/secret-box';
import { RosterSourceService } from './roster-source.service';
import { RosterRunService } from './roster-run.service';
import { RosterApplyService } from './roster-apply.service';
import { RosterClaimService } from './roster-claim.service';
import { RosteringFeatureGuard } from './rostering-feature.guard';
import { RosteringController } from './rostering.controller';
import { ROSTER_SECRET_INFO, rosterSecretAad } from './rostering.constants';

const SOURCE = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const SCHOOL = '11111111-1111-4111-8111-111111111111';

function sourceRow(over: Record<string, unknown> = {}) {
  return {
    id: SOURCE, name: 'SIS', kind: 'oneroster_api', base_url: 'https://sis.example.org/or', token_url: 'https://sis.example.org/token',
    client_id: 'cid', client_secret_enc: null, settings: {}, schedule: 'off', auto_apply: false, last_scheduled_at: null,
    created_by: 'admin', created_at: new Date(), updated_at: new Date(), ...over,
  };
}

describe('rostering feature (organisation-level)', () => {
  const ctx = {} as ExecutionContext;

  test('flag off => 403 FEATURE_DISABLED on every route; on => allowed', async () => {
    const prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: {} }); // default off
    const off = new RosteringFeatureGuard(new FeatureService(prisma as any, createMockCacheService() as any));
    const err = await rejected(off.canActivate());
    expect(err).toBeInstanceOf(FeatureDisabledException);
    expect((err as FeatureDisabledException).getStatus()).toBe(403);
    expect(((err as FeatureDisabledException).getResponse() as { code: string }).code).toBe('FEATURE_DISABLED');

    prisma.organisation.findFirst.mockResolvedValue({ features: { rostering: true } });
    const on = new RosteringFeatureGuard(new FeatureService(prisma as any, createMockCacheService() as any));
    expect(await on.canActivate()).toBe(true);
    void ctx;
  });

  test('the controller is for signed-in organisation admins, behind the feature guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, RosteringController);
    expect(guards).toEqual([AuthGuard, OrganisationAdminGuard, RosteringFeatureGuard]);
    for (const m of ['create', 'remove'] as const) {
      expect(Reflect.getMetadata(STEP_UP_KEY, RosteringController.prototype[m])).toBe(true);
    }
  });

  test('changing the endpoint or secret needs step-up; the org mapping does not', () => {
    const sources = { update: mock(async () => ({})) };
    const c = new RosteringController(sources as any, {} as any);
    const req = { user: { id: 'admin', sessionId: 's', elevatedUntil: null } };
    expect(() => c.update(req, SOURCE, { clientSecret: 'new' })).toThrow();
    void c.update(req, SOURCE, { settings: { orgMap: {} } });
    expect(sources.update).toHaveBeenCalledTimes(1);
    void c.update({ user: { ...req.user, elevatedUntil: Date.now() + 60_000 } }, SOURCE, { clientSecret: 'new' });
    expect(sources.update).toHaveBeenCalledTimes(2);
  });
});

describe('RosterSourceService', () => {
  let prisma: MockPrisma;
  let service: RosterSourceService;
  beforeEach(() => {
    prisma = createMockPrisma();
    service = new RosterSourceService(prisma as any, { uploadUrl: mock(async () => 'https://s3/put') } as any);
  });

  test('credentials are encrypted at rest, bound to the source, and never returned', async () => {
    prisma.roster_source.create.mockResolvedValue({ id: SOURCE });
    prisma.roster_source.update.mockImplementation(async ({ data }: any) => sourceRow({ client_secret_enc: data.client_secret_enc }));
    const view = await service.create(
      { name: 'SIS', kind: 'oneroster_api', baseUrl: 'https://sis.example.org/or', tokenUrl: 'https://sis.example.org/token', clientId: 'cid', clientSecret: 'super-secret-value' },
      'admin',
    );
    const stored = prisma.roster_source.update.mock.calls[0][0].data.client_secret_enc as string;
    expect(stored).not.toContain('super-secret-value');
    expect(stored).toMatch(/^v[12]:/);
    expect(openSecret(ROSTER_SECRET_INFO, rosterSecretAad(SOURCE), stored)).toBe('super-secret-value');
    // Another source's AAD cannot open it.
    expect(openSecret(ROSTER_SECRET_INFO, rosterSecretAad('other'), stored)).toBeNull();
    expect(JSON.stringify(view)).not.toContain('super-secret-value');
    expect(view).toMatchObject({ hasSecret: true, secretUnreadable: false });
    expect(JSON.stringify(prisma.roster_source.create.mock.calls[0][0])).not.toContain('super-secret-value');
  });

  test('an API source needs https URLs and a secret; CSV sources cannot be scheduled', async () => {
    const base = { name: 'SIS', kind: 'oneroster_api' as const, tokenUrl: 'https://sis.example.org/token', clientId: 'c', clientSecret: 's' };
    expect(await rejected(service.create({ ...base, baseUrl: 'http://sis.example.org/or' }, 'a'))).toBeInstanceOf(BadRequestException);
    expect(await rejected(service.create({ ...base, baseUrl: 'https://sis.example.org/or', clientSecret: undefined }, 'a'))).toBeInstanceOf(BadRequestException);
    expect(await rejected(service.create({ name: 'CSV', kind: 'csv', schedule: 'daily' }, 'a'))).toBeInstanceOf(BadRequestException);
  });

  test('test connection to a private address is refused by the SSRF guard', async () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
    const out = await service.testConnection({ baseUrl: 'https://127.0.0.1/or', tokenUrl: 'https://127.0.0.1/token', clientId: 'c', clientSecret: 's' });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('private or reserved address');
  });

  test('the org mapping only accepts existing schools', async () => {
    prisma.roster_source.findUnique.mockResolvedValue(sourceRow({ kind: 'csv', base_url: null, token_url: null, client_id: null }));
    prisma.school.count.mockResolvedValue(0);
    expect(await rejected(service.update(SOURCE, { settings: { orgMap: { o1: SCHOOL } } }, 'a'))).toBeInstanceOf(BadRequestException);
    prisma.school.count.mockResolvedValue(1);
    prisma.roster_source.update.mockImplementation(async ({ data }: any) => sourceRow({ kind: 'csv', settings: data.settings }));
    const view = await service.update(SOURCE, { settings: { orgMap: { o1: SCHOOL, o2: null } } }, 'a');
    expect(view.settings.orgMap).toEqual({ o1: SCHOOL, o2: null });
  });

  test('upload tickets are only for CSV sources, under the source prefix', async () => {
    prisma.roster_source.findUnique.mockResolvedValue(sourceRow({ kind: 'csv' }));
    const t = await service.uploadTicket(SOURCE, { filename: 'OneRoster export.zip', contentType: 'application/zip', size: 1000 });
    expect(t.key).toMatch(new RegExp(`^rostering/uploads/${SOURCE}/[0-9a-f]{24}-OneRoster-export\\.zip$`));
    prisma.roster_source.findUnique.mockResolvedValue(sourceRow());
    expect(await rejected(service.uploadTicket(SOURCE, { filename: 'a.csv', contentType: 'text/csv', size: 1 }))).toBeInstanceOf(BadRequestException);
  });
});

describe('RosterRunService', () => {
  let prisma: MockPrisma;
  let applier: { apply: ReturnType<typeof mock> };
  let runs: RosterRunService;
  let runRow: Record<string, any>;
  let changes: Record<string, any>[];

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: { rostering: true } });
    applier = { apply: mock(async () => {}) };
    runRow = {
      id: RUN, source_id: SOURCE, trigger: 'manual', status: 'planned', summary: {}, error: null, include_disables: false,
      progress_done: 0, progress_total: 0, progress_failed: 0, created_by: 'admin', applied_by: 'admin',
      created_at: new Date('2026-11-01'), planned_at: new Date(), apply_started_at: null, finished_at: null,
    };
    changes = [
      { id: 'c1', seq: 0, entity: 'student', action: 'create', status: 'pending' },
      { id: 'c2', seq: 1, entity: 'student', action: 'update', status: 'pending' },
      { id: 'c3', seq: 2, entity: 'student', action: 'disable', status: 'pending' },
    ];
    prisma.roster_run.findUnique.mockImplementation(async () => ({ ...runRow }));
    prisma.roster_run.updateMany.mockImplementation(async ({ where, data }: any) => {
      const statuses = where.status?.in ?? (where.status ? [where.status] : null);
      if (statuses && !statuses.includes(runRow.status)) return { count: 0 };
      Object.assign(runRow, data);
      return { count: 1 };
    });
    prisma.roster_run.update.mockImplementation(async ({ data }: any) => {
      for (const [k, v] of Object.entries(data)) {
        runRow[k] = v && typeof v === 'object' && 'increment' in (v as any) ? runRow[k] + (v as any).increment : v;
      }
      return runRow;
    });
    prisma.roster_source.findUnique.mockResolvedValue({ id: SOURCE, settings: {}, created_by: 'admin' });
    prisma.roster_change.count.mockImplementation(async ({ where }: any) =>
      changes.filter((c) => c.status === 'pending' && (!where.action || c.action !== 'disable')).length,
    );
    prisma.roster_change.updateMany.mockImplementation(async ({ where, data }: any) => {
      let n = 0;
      for (const c of changes) {
        if (c.status === where.status && c.action === where.action) {
          Object.assign(c, data);
          n++;
        }
      }
      return { count: n };
    });
    prisma.roster_change.findMany.mockImplementation(async ({ where }: any) =>
      changes.filter((c) => c.status === where.status).sort((a, b) => a.seq - b.seq),
    );
    prisma.roster_change.update.mockImplementation(async ({ where, data }: any) => {
      Object.assign(changes.find((c) => c.id === where.id)!, data);
      return {};
    });
    applier.apply.mockImplementation(async (change: any) => {
      changes.find((c) => c.id === change.id)!.status = 'applied';
    });
    const features = new FeatureService(prisma as any, createMockCacheService() as any);
    runs = new RosterRunService(prisma as any, {} as any, features, {} as any, {} as any, applier as any);
  });

  test('disables require confirmation: without it they are skipped and never applied', async () => {
    await runs.apply(RUN, {}, 'admin');
    await runs.inflight;
    expect(runRow.status).toBe('applied');
    expect(runRow.progress_total).toBe(2);
    expect(applier.apply.mock.calls.map((c: any) => c[0].id)).toEqual(['c1', 'c2']);
    expect(changes.find((c) => c.id === 'c3')).toMatchObject({ status: 'skipped' });
  });

  test('confirmed disables are applied, last', async () => {
    await runs.apply(RUN, { includeDisables: true }, 'admin');
    await runs.inflight;
    expect(applier.apply.mock.calls.map((c: any) => c[0].id)).toEqual(['c1', 'c2', 'c3']);
    expect(runRow.include_disables).toBe(true);
  });

  test('a failing row is reported and the rest still applies', async () => {
    applier.apply.mockImplementation(async (change: any) => {
      if (change.id === 'c1') throw new Error('Student number taken');
      changes.find((c) => c.id === change.id)!.status = 'applied';
    });
    await runs.apply(RUN, {}, 'admin');
    await runs.inflight;
    expect(changes[0]).toMatchObject({ status: 'failed', apply_error: 'Student number taken' });
    expect(runRow).toMatchObject({ status: 'applied', progress_done: 1, progress_failed: 1 });
  });

  test('resumable: an interrupted apply continues from the pending changes only', async () => {
    // A restart left the run applying with c1 done.
    changes[0].status = 'applied';
    runRow.status = 'applying';
    runRow.apply_started_at = new Date();
    runRow.progress_done = 1;
    prisma.roster_run.findMany.mockResolvedValue([{ id: RUN }]);
    const out = await runs.resumeStale(new Date());
    await runs.inflight;
    expect(out.resumed).toBe(1);
    expect(applier.apply.mock.calls.map((c: any) => c[0].id)).toEqual(['c2']);
    expect(runRow).toMatchObject({ status: 'applied', progress_done: 2 });
    // Running the job again is a no-op once applied.
    await runs.applyRun(RUN);
    expect(applier.apply).toHaveBeenCalledTimes(1);
  });

  test('only a planned run, and only the newest, can be applied', async () => {
    prisma.roster_run.findFirst.mockResolvedValue({ id: 'newer' });
    expect(await rejected(runs.apply(RUN, {}, 'admin'))).toBeInstanceOf(ConflictException);
    prisma.roster_run.findFirst.mockResolvedValue(null);
    runRow.status = 'applied';
    expect(await rejected(runs.apply(RUN, {}, 'admin'))).toBeInstanceOf(ConflictException);
  });

  test('rostering switched off mid-apply stops it', async () => {
    prisma.organisation.findFirst.mockResolvedValue({ features: {} });
    runRow.status = 'queued';
    await runs.applyRun(RUN);
    expect(runRow.status).toBe('failed');
    expect(applier.apply).not.toHaveBeenCalled();
  });

  test('a CSV dry run refuses uploads of another source, and a second concurrent run', async () => {
    const sources = { require: mock(async () => sourceRow({ kind: 'csv' })) };
    const r = new RosterRunService(prisma as any, {} as any, {} as any, sources as any, {} as any, applier as any);
    expect(await rejected(r.startDryRun(SOURCE, ['rostering/uploads/other/x.csv'], 'a'))).toBeInstanceOf(BadRequestException);
    expect(await rejected(r.startDryRun(SOURCE, [], 'a'))).toBeInstanceOf(BadRequestException);
    prisma.roster_run.findFirst.mockResolvedValue({ id: 'running' });
    expect(await rejected(r.startDryRun(SOURCE, [`rostering/uploads/${SOURCE}/a.csv`], 'a'))).toBeInstanceOf(ConflictException);
  });

  test('errors CSV lists source errors and failed rows, formula-safe', async () => {
    prisma.roster_change.findMany.mockResolvedValue([
      { entity: 'student', action: 'error', sourced_id: 'users.csv:7', label: '=cmd()', errors: ['bad email'], apply_error: null, status: 'skipped' },
      { entity: 'course', action: 'create', sourced_id: 'c1', label: 'Maths, 7A', errors: [], apply_error: 'boom', status: 'failed' },
    ]);
    const csv = await runs.errorsCsv(SOURCE, RUN);
    expect(csv.split('\r\n')).toEqual([
      'entity,action,source_id,record,status,error',
      "student,error,users.csv:7,'=cmd(),skipped,bad email",
      'course,create,c1,"Maths, 7A",failed,boom',
      '',
    ]);
  });
});

describe('RosterApplyService', () => {
  let prisma: MockPrisma;
  let invites: { invite: ReturnType<typeof mock> };
  let service: RosterApplyService;
  const ctx = { sourceId: SOURCE, actorId: 'admin', settings: { orgMap: {}, matchBy: { email: true, studentNumber: true }, notifyStudents: false, sendStaffInvites: false, scope: null } };

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.roster_change.findUnique.mockResolvedValue({ status: 'pending' });
    invites = { invite: mock(async () => ({ id: 'inv-1', email: 'x', expiresAt: '' })) };
    const claims = { claimExisting: mock(async () => null), notifyStudent: mock(async () => {}) };
    service = new RosterApplyService(prisma as any, createMockCacheService() as any, invites as any, claims as any);
  });

  test('a create whose link already points at a live record updates it (no duplicate)', async () => {
    prisma.roster_link.findUnique.mockResolvedValue({ target_id: 'st-1', data: {}, disabled_at: null });
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1', user_profile_id: null });
    await service.apply(
      { id: 'c1', entity: 'student', action: 'create', sourced_id: 'u1', target_id: null, school_id: SCHOOL, label: 'R, J', diff: { firstName: { from: null, to: 'J' } }, data: { schoolId: SCHOOL, firstName: 'J' } },
      ctx,
    );
    expect(prisma.student.create).not.toHaveBeenCalled();
    expect(prisma.student.update.mock.calls[0][0]).toMatchObject({ where: { id: 'st-1' }, data: { first_name: 'J' } });
    expect(prisma.roster_change.update.mock.calls[0][0].data.status).toBe('applied');
  });

  test('a change applied by an earlier attempt is not applied again', async () => {
    prisma.roster_change.findUnique.mockResolvedValue({ status: 'applied' });
    await service.apply({ id: 'c1', entity: 'student', action: 'create', sourced_id: 'u1', target_id: null, school_id: SCHOOL, label: 'x', diff: {}, data: { schoolId: SCHOOL } }, ctx);
    expect(prisma.student.create).not.toHaveBeenCalled();
    expect(prisma.roster_change.update).not.toHaveBeenCalled();
  });

  test('staff without an account get a school_staff invite (email as the source chose), reused on retry', async () => {
    const change = { id: 'c2', entity: 'staff', action: 'create', sourced_id: 't1', target_id: null, school_id: SCHOOL, label: 'Ada', diff: {}, data: { schoolId: SCHOOL, email: 'ada@x.org', mode: 'invite' } };
    await service.apply(change, ctx);
    expect(invites.invite).toHaveBeenCalledWith('admin', 'school_staff', 'ada@x.org', SCHOOL, { sendEmail: false });
    prisma.organisation_invite.findFirst.mockResolvedValue({ id: 'inv-1' });
    await service.apply(change, ctx);
    expect(invites.invite).toHaveBeenCalledTimes(1);
  });

  test('staff with an account become teachers, never admins', async () => {
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: null, account_type: 'staff' });
    await service.apply({ id: 'c3', entity: 'staff', action: 'create', sourced_id: 't1', target_id: 'u-1', school_id: SCHOOL, label: 'Ada', diff: {}, data: { schoolId: SCHOOL, email: 'a@x.org', mode: 'membership', userId: 'u-1' } }, ctx);
    expect(prisma.school_management.create.mock.calls[0][0].data).toMatchObject({ user_id: 'u-1', school_id: SCHOOL, role: 'teacher' });
  });

  test('disables deactivate and archive, never delete records', async () => {
    prisma.student.findUnique.mockResolvedValue({ user_profile_id: null, school_id: SCHOOL });
    await service.apply({ id: 'd1', entity: 'student', action: 'disable', sourced_id: 'u1', target_id: 'st-1', school_id: SCHOOL, label: 'x', diff: {}, data: {} }, ctx);
    expect(prisma.student.update.mock.calls[0][0].data).toEqual({ is_active: false });
    expect(prisma.student.delete).not.toHaveBeenCalled();
    prisma.course.findUnique.mockResolvedValue({ status: 'published' });
    await service.apply({ id: 'd2', entity: 'course', action: 'disable', sourced_id: 'c1', target_id: 'co-1', school_id: SCHOOL, label: 'x', diff: {}, data: {} }, ctx);
    expect(prisma.course.update.mock.calls[0][0].data.status).toBe('archived');
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  test('the last teacher of a course is kept', async () => {
    prisma.course_staff.findUnique.mockResolvedValue({ course_id: 'co-1', role: 'teacher' });
    prisma.course_staff.count.mockResolvedValue(1);
    const err = await rejected(
      service.apply({ id: 'd3', entity: 'course_staff', action: 'disable', sourced_id: 'e1', target_id: 'cs-1', school_id: SCHOOL, label: 'x', diff: {}, data: {} }, ctx),
    );
    expect(err.message).toContain('last teacher');
    expect(prisma.course_staff.delete).not.toHaveBeenCalled();
  });
});

describe('RosterClaimService', () => {
  let prisma: MockPrisma;
  let service: RosterClaimService;
  beforeEach(() => {
    prisma = createMockPrisma();
    service = new RosterClaimService(prisma as any, createMockCacheService() as any, { configured: () => false } as any, { onVerifiedSignIn: mock() } as any);
  });

  test('a verified sign-in with the roster email links the student and makes a student profile', async () => {
    prisma.roster_link.findMany.mockResolvedValue([{ target_id: 'st-1' }]);
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1', school_id: SCHOOL, first_name: 'Jordan', last_name: 'Rivera' });
    prisma.student.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.claimFor({ id: 'u-9', email: 'Jordan@School.org' })).toBe('st-1');
    expect(prisma.roster_link.findMany.mock.calls[0][0].where.email).toBe('jordan@school.org');
    expect(prisma.student.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'st-1', user_profile_id: null }, data: { user_profile_id: 'u-9' } });
    expect(prisma.user_profile.create.mock.calls[0][0].data).toMatchObject({ id: 'u-9', school_id: SCHOOL, account_type: 'student' });
  });

  test('never links an account already in a school, or a parent', async () => {
    prisma.roster_link.findMany.mockResolvedValue([{ target_id: 'st-1' }]);
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1', school_id: SCHOOL });
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'elsewhere', account_type: 'staff', _count: { school_management: 1 } });
    expect(await service.claimFor({ id: 'u-9', email: 'a@x.org' })).toBeNull();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: null, account_type: 'parent', _count: { school_management: 0 } });
    expect(await service.claimFor({ id: 'u-9', email: 'a@x.org' })).toBeNull();
    expect(prisma.student.updateMany).not.toHaveBeenCalled();
  });
});
