import { describe, expect, mock, test } from 'bun:test';
import { Readable } from 'node:stream';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { StudentReportsService } from '@/report-card/student-reports.service';
import { reportKey } from '@/report-card/report-keys';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { ParentGuard } from './parent.guard';
import { ParentReportController } from './parent-report.controller';
import { ParentReportsService } from './parent-reports.service';
import { DEFAULT_PARENT_SETTINGS, mergeParentSettings, parseParentSettings } from './parent-settings';

const CHILD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DOC = '55555555-5555-4555-8555-555555555555';
const TERM = '66666666-6666-4666-8666-666666666666';
const SCHOOL = '77777777-7777-4777-8777-777777777777';
const PARENT = 'parent-1';
const CTX = { studentId: CHILD, schoolId: SCHOOL };

const ROUTES: [string, Record<string, string>][] = [
  ['list', { studentId: CHILD }],
  ['file', { studentId: CHILD, documentId: DOC }],
  ['link', { studentId: CHILD, documentId: DOC }],
  ['transcript', { studentId: CHILD }],
  ['transcriptPdf', { studentId: CHILD }],
];

function context(method: string, request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (ParentReportController.prototype as any)[method],
    getClass: () => ParentReportController,
  } as unknown as ExecutionContext;
}

function guards(opts: { org?: Record<string, boolean>; disabled?: string[]; dob?: Date | null; settings?: object } = {}) {
  const prisma: MockPrisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: opts.org ?? { parent_portal: true } });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === SCHOOL ? { disabled_features: opts.disabled ?? [] } : null,
  );
  prisma.user_profile.findUnique.mockResolvedValue({ account_type: 'parent', is_active: true });
  prisma.parent_student_link.findFirst.mockImplementation(async ({ where }: any) =>
    where.user_profile_id === PARENT && where.student_id === CHILD
      ? {
          student: {
            id: CHILD,
            school_id: SCHOOL,
            is_active: true,
            date_of_birth: opts.dob ?? null,
            school: { parent_settings: opts.settings ?? {}, is_active: true },
          },
        }
      : null,
  );
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const parentGuard = new ParentGuard(prisma as any, features);
  const featureGuard = new FeatureGuard(new Reflector(), features, prisma as any);
  return async (method: string, params: Record<string, string>) => {
    const req: any = { user: { id: PARENT }, params };
    const ctx = context(method, req);
    await parentGuard.canActivate(ctx);
    await featureGuard.canActivate(ctx);
    return req;
  };
}

describe('parent report routes are guarded', () => {
  test('AuthGuard, ParentGuard and FeatureGuard on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ParentReportController)).toEqual([AuthGuard, ParentGuard, FeatureGuard]);
    const methods = Object.getOwnPropertyNames(ParentReportController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(ROUTES.map(([m]) => m).sort());
  });

  for (const [method, params] of ROUTES) {
    test(`${method}: 403 FEATURE_DISABLED with parent_portal off`, async () => {
      const err: any = await expectRejection(guards({ org: { parent_portal: false } })(method, params));
      expect(err).toBeInstanceOf(FeatureDisabledException);
      expect(err.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'parent_portal' });
    });

    test(`${method}: 403 FEATURE_DISABLED when the school switched report cards off`, async () => {
      const err: any = await expectRejection(guards({ disabled: ['report_cards'] })(method, params));
      expect(err.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'report_cards' });
    });

    test(`${method}: another family's child, or one over the age limit, is a 404`, async () => {
      expect(await expectRejection(guards()(method, { ...params, studentId: OTHER }))).toBeInstanceOf(NotFoundException);
      const old = guards({ settings: { maxStudentAge: 18 }, dob: new Date('2000-01-01') });
      expect(await expectRejection(old(method, params))).toBeInstanceOf(NotFoundException);
    });

    test(`${method}: allowed for the linked child with both features on`, async () => {
      const req = await guards()(method, params);
      expect(req.parent).toEqual({ userId: PARENT, studentId: CHILD, schoolId: SCHOOL });
    });
  }
});

describe('showReports parent setting', () => {
  test('defaults to shown and can be turned off', () => {
    expect(DEFAULT_PARENT_SETTINGS.showReports).toBe(true);
    expect(parseParentSettings({}).showReports).toBe(true);
    expect(parseParentSettings({ showReports: false }).showReports).toBe(false);
    expect(parseParentSettings({ showReports: 'no' }).showReports).toBe(true);
    expect(mergeParentSettings(DEFAULT_PARENT_SETTINGS, { showReports: false })).toEqual({
      settings: { ...DEFAULT_PARENT_SETTINGS, showReports: false },
    });
    expect(mergeParentSettings(DEFAULT_PARENT_SETTINGS, { showReports: 1 })).toEqual({
      error: 'showReports must be true or false',
    });
  });

  function service(settings: object) {
    const prisma = createMockPrisma();
    prisma.school.findUnique.mockResolvedValue({ parent_settings: settings });
    const reports = {
      publishedReportsFor: mock(async () => []),
      openReport: mock(async () => ({ body: Readable.from([]), size: 0, filename: 'r.pdf' })),
      createDownloadLink: mock(async () => ({ url: '/api/report-cards/files/t', expiresAt: 'x' })),
      transcriptFor: mock(async () => ({
        school: { name: 'Hillside', logo: { bytes: new Uint8Array([1]), type: 'png' } },
        student: { name: 'Ada Lovelace' },
        terms: [],
        generatedAt: new Date('2027-01-01T00:00:00Z'),
      })),
      transcriptPdfFor: mock(async () => ({ bytes: new Uint8Array(), filename: 't.pdf' })),
    };
    return { reports, svc: new ParentReportsService(prisma as any, reports as any) };
  }

  test('hidden: every route is 403 PARENT_VIEW_HIDDEN and nothing is read', async () => {
    const { reports, svc } = service({ showReports: false });
    for (const call of [
      () => svc.list(CTX),
      () => svc.open(CTX, DOC),
      () => svc.link(CTX, DOC),
      () => svc.transcript(CTX),
      () => svc.transcriptPdf(CTX),
    ]) {
      const err: any = await expectRejection(call());
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'PARENT_VIEW_HIDDEN' });
    }
    for (const fn of Object.values(reports)) expect(fn).not.toHaveBeenCalled();
  });

  test('shown: reads go to the report service for the guarded child only', async () => {
    const { reports, svc } = service({});
    await svc.list(CTX);
    await svc.open(CTX, DOC);
    await svc.link(CTX, DOC);
    await svc.transcriptPdf(CTX);
    expect(reports.publishedReportsFor).toHaveBeenCalledWith(CHILD);
    expect(reports.openReport).toHaveBeenCalledWith(CHILD, DOC);
    expect(reports.createDownloadLink).toHaveBeenCalledWith(CHILD, DOC);
    expect(reports.transcriptPdfFor).toHaveBeenCalledWith(CHILD);
    // The transcript JSON carries no school logo bytes.
    expect(await svc.transcript(CTX)).toEqual({
      student: { name: 'Ada Lovelace' },
      terms: [],
      generatedAt: '2027-01-01T00:00:00.000Z',
    });
  });
});

describe('parents never see unpublished reports', () => {
  function real(published: Date | null) {
    const prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: {} });
    prisma.school.findUnique.mockResolvedValue({ parent_settings: {}, disabled_features: [] });
    prisma.student.findUnique.mockResolvedValue({ school_id: SCHOOL });
    prisma.report_release.findMany.mockResolvedValue(published ? [{ term_id: TERM, published_at: published }] : []);
    prisma.report_release.findUnique.mockResolvedValue({ published_at: published });
    prisma.report_document.findMany.mockResolvedValue([
      {
        id: DOC,
        term_id: TERM,
        status: 'ready',
        term: { name: 'Autumn', start_date: null, end_date: null, academic_year: null },
      },
    ]);
    prisma.report_document.findUnique.mockResolvedValue({
      id: DOC,
      school_id: SCHOOL,
      term_id: TERM,
      student_id: CHILD,
      status: 'ready',
      storage_key: reportKey(SCHOOL, TERM, CHILD),
      term: { name: 'Autumn' },
      student: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    const storage = {
      get: mock(async () => ({ body: Readable.from([Buffer.from('%PDF')]), size: 4 })),
    };
    const features = new FeatureService(prisma as any, createMockCacheService() as any);
    const students = new StudentReportsService(prisma as any, storage as any, {} as any, features);
    return { svc: new ParentReportsService(prisma as any, students), storage, prisma };
  }

  test('before publishing: an empty list, and the document is a 404', async () => {
    const { svc, storage, prisma } = real(null);
    expect(await svc.list(CTX)).toEqual([]);
    expect(prisma.report_document.findMany).not.toHaveBeenCalled();
    expect(await expectRejection(svc.open(CTX, DOC))).toBeInstanceOf(NotFoundException);
    expect(await expectRejection(svc.link(CTX, DOC))).toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });

  test('once published: listed and downloadable', async () => {
    const { svc } = real(new Date('2026-12-18T10:00:00Z'));
    expect((await svc.list(CTX)).map((r) => r.id)).toEqual([DOC]);
    expect((await svc.open(CTX, DOC)).filename).toBe('Lovelace-Ada-Autumn-report.pdf');
    expect((await svc.link(CTX, DOC)).url).toStartWith('/api/report-cards/files/');
  });

  test("another child's document is a 404 even when published", async () => {
    const { svc } = real(new Date());
    expect(await expectRejection(svc.open({ studentId: OTHER, schoolId: SCHOOL }, DOC))).toBeInstanceOf(NotFoundException);
  });
});
