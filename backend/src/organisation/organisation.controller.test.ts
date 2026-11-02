import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { OrganisationController, SetupController } from './organisation.controller';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { AuthGuard } from '@/auth/auth.guard';
import { SchoolController } from '@/school/school.controller';
import { AppModule } from '@/app.module';
import { createMockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';

const routes = (controller: any) =>
  Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = controller.prototype[name];
      return {
        name,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
        path: Reflect.getMetadata(PATH_METADATA, handler) as string,
        guards: (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[],
      };
    })
    .filter((r) => r.path !== undefined);

describe('SetupController', () => {
  test('lives at /setup with no class-level guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SetupController)).toBe('setup');
    expect(Reflect.getMetadata(GUARDS_METADATA, SetupController)).toBeUndefined();
  });

  test('GET /setup/status is public; POST /setup needs a session', () => {
    const byName = Object.fromEntries(routes(SetupController).map((r) => [r.name, r]));
    expect(byName.status.path).toBe('status');
    expect(byName.status.guards).toEqual([]);
    expect(byName.setup.method).toBe(RequestMethod.POST);
    expect(byName.setup.guards).toEqual([AuthGuard]);
  });
});

describe('OrganisationController', () => {
  test('every route needs a session and an organisation admin', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrganisationController)).toBe('organisation');
    expect(Reflect.getMetadata(GUARDS_METADATA, OrganisationController)).toEqual([
      AuthGuard,
      OrganisationAdminGuard,
    ]);
  });

  test('exposes the contracted routes', () => {
    const seen = routes(OrganisationController)
      .map((r) => `${RequestMethod[r.method]} ${r.path}`)
      .sort();
    expect(seen).toEqual(
      [
        'GET /',
        'PATCH /',
        'GET features',
        'PATCH features',
        'GET overview',
        'GET admins',
        'POST admins',
        'DELETE admins/:userId',
        'GET schools',
        'POST schools',
        'GET schools/:id',
        'PATCH schools/:id',
        'GET schools/:id/upload-limit',
        'PATCH schools/:id/upload-limit',
        'GET schools/:id/features',
        'PATCH schools/:id/features',
        'POST schools/:id/logo/upload-ticket',
        'POST schools/:id/logo/complete',
        'DELETE schools/:id/logo',
        'PUT schools/:id/admin',
        'POST users/:userId/sessions/revoke',
      ].sort(),
    );
  });
});

describe('schools and billing', () => {
  test('POST /schools is gone: schools are created by organisation admins', () => {
    const posts = routes(SchoolController).filter(
      (r) => r.method === RequestMethod.POST && (r.path === '/' || r.path === ''),
    );
    expect(posts).toEqual([]);
  });

  test('the app module has the organisation module and no billing module', () => {
    const imports: any[] = Reflect.getMetadata('imports', AppModule) ?? [];
    const names = imports.map((m) => m?.name ?? m?.module?.name);
    expect(names).toContain('OrganisationModule');
    expect(names.some((n) => /billing/i.test(String(n)))).toBe(false);
  });
});

describe("OrganisationController: one school's settings", () => {
  const SCHOOL = '11111111-1111-4111-8111-111111111111';
  const req = { user: { id: 'org-admin' } };
  let known: Set<string>;
  let organisation: any;
  let features: any;
  let uploadLimits: any;
  let logos: any;
  let versioning: any;
  let controller: OrganisationController;

  beforeEach(() => {
    known = new Set([SCHOOL]);
    organisation = {
      requireSchool: mock(async (id: string) => {
        if (!known.has(id)) throw new NotFoundException('School not found');
      }),
      school: mock(async (id: string) => ({ id, logoUrl: null })),
    };
    features = {
      schoolFeatures: mock(async (id: string) => ({ schoolId: id })),
      updateSchoolFeatures: mock(async (id: string, f: unknown) => ({ id, f })),
    };
    uploadLimits = {
      forSchool: mock(async () => ({ maxUploadMb: 10 })),
      setForSchool: mock(async (_id: string, mb: number | null) => ({ maxUploadMb: mb })),
    };
    logos = {
      createTicket: mock(async () => ({ uploadUrl: 'u', path: 'p' })),
      complete: mock(async () => ({ logoUrl: 'l' })),
      remove: mock(async () => ({ logoUrl: null })),
    };
    versioning = { resolve: mock(() => (raw: unknown) => raw) };
    controller = new OrganisationController(
      organisation,
      features,
      uploadLimits,
      logos,
      versioning,
    );
  });

  const calls = (c: OrganisationController, id: string) => [
    () => c.school(id),
    () => c.schoolUploadLimit(req, id),
    () => c.updateSchoolUploadLimit(req, id, { maxUploadMb: 20 } as any),
    () => c.schoolFeatures(id),
    () => c.updateSchoolFeatures(id, { features: { messaging: false } } as any),
    () => c.schoolLogoTicket(id, { contentType: 'image/png', totalSize: 10 } as any),
    () => c.schoolLogoComplete(id, { path: 'uploads/x.png' } as any),
    () => c.schoolLogoRemove(id),
  ];

  test('a non-organisation-admin is refused (403) before any school route', async () => {
    // The class-level guard covers every per-school route.
    const guard = new OrganisationAdminGuard(createMockPrisma() as any);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'teacher' } }) }),
    } as any;
    expect(await expectRejection(guard.canActivate(context))).toBeInstanceOf(
      ForbiddenException,
    );
    for (const r of routes(OrganisationController).filter((r) => r.path.startsWith('schools/:id'))) {
      expect(r.guards).toEqual([]);
    }
  });

  test('an unknown school is a 404 and reaches no service', async () => {
    organisation.school = mock(async () => {
      throw new NotFoundException('School not found');
    });
    for (const call of calls(controller, '22222222-2222-4222-8222-222222222222')) {
      expect(await expectRejection(call())).toBeInstanceOf(NotFoundException);
    }
    expect(uploadLimits.forSchool).not.toHaveBeenCalled();
    expect(uploadLimits.setForSchool).not.toHaveBeenCalled();
    expect(features.schoolFeatures).not.toHaveBeenCalled();
    expect(features.updateSchoolFeatures).not.toHaveBeenCalled();
    expect(logos.createTicket).not.toHaveBeenCalled();
    expect(logos.complete).not.toHaveBeenCalled();
    expect(logos.remove).not.toHaveBeenCalled();
  });

  test('GET schools/:id returns the row with its logo', async () => {
    expect(await controller.school(SCHOOL)).toEqual({ id: SCHOOL, logoUrl: null } as any);
    expect(organisation.school).toHaveBeenCalledWith(SCHOOL);
  });

  test('upload limit delegates with that school and the same transformer', async () => {
    expect(await controller.schoolUploadLimit(req, SCHOOL)).toEqual({ maxUploadMb: 10 } as any);
    expect(uploadLimits.forSchool).toHaveBeenCalledWith(SCHOOL);
    await controller.updateSchoolUploadLimit(req, SCHOOL, { maxUploadMb: null } as any);
    expect(uploadLimits.setForSchool).toHaveBeenCalledWith(SCHOOL, null);
    expect(versioning.resolve).toHaveBeenCalledWith(req, 'school.uploadLimit');
  });

  test('features delegate with that school', async () => {
    await controller.schoolFeatures(SCHOOL);
    expect(features.schoolFeatures).toHaveBeenCalledWith(SCHOOL);
    await controller.updateSchoolFeatures(SCHOOL, { features: { messaging: false } } as any);
    expect(features.updateSchoolFeatures).toHaveBeenCalledWith(SCHOOL, { messaging: false });
  });

  test('logo routes delegate with that school', async () => {
    await controller.schoolLogoTicket(SCHOOL, { contentType: 'image/png', totalSize: 10 } as any);
    expect(logos.createTicket).toHaveBeenCalledWith(SCHOOL, 'image/png', 10);
    await controller.schoolLogoComplete(SCHOOL, { path: 'uploads/x.png' } as any);
    expect(logos.complete).toHaveBeenCalledWith(SCHOOL, 'uploads/x.png');
    expect(await controller.schoolLogoRemove(SCHOOL)).toEqual({ logoUrl: null });
    expect(logos.remove).toHaveBeenCalledWith(SCHOOL);
  });
});
