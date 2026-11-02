import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { AuthGuard } from '@/auth/auth.guard';
import { createMockPrisma } from '@/test/prisma-mock';
import { PermissionGuard } from '@/permission/permission.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { SchoolController } from '@/school/school.controller';
import { SsoSettingsService } from '@/sso/sso-settings.service';
import { SsoRegistry } from '@/sso/sso.registry';
import { SchoolSsoService } from '@/sso/school-sso.service';
import { decryptSsoSecret } from '@/sso/sso-secret';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { SignInController } from './sign-in.controller';

const S = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const D = '22222222-2222-4222-8222-222222222222';

const savedEnv = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
  process.env.API_URL = 'https://api.gb.test';
  process.env.SSO_PROVIDERS = 'google';
  process.env.GOOGLE_CLIENT_ID = 'env-google-id';
  process.env.GOOGLE_CLIENT_SECRET = 'env-google-secret';
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_SECRET;
  delete process.env.SAML_SP_ENTITY_ID;
});

/** SchoolSsoService over an in-memory public.school_sso_provider. */
function setup() {
  const rows: any[] = [];
  const prisma = createMockPrisma();
  const match = (r: any, w: any) =>
    r.school_id === w.school_id_provider.school_id && r.provider === w.school_id_provider.provider;
  prisma.school_sso_provider.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => r.school_id === where.school_id).map((r) => ({ ...r })),
  );
  prisma.school_sso_provider.findUnique.mockImplementation(async ({ where }: any) =>
    rows.find((r) => match(r, where)) ?? null,
  );
  prisma.school_sso_provider.update.mockImplementation(async ({ where, data }: any) => {
    const i = rows.findIndex((r) => match(r, where));
    rows[i] = { ...rows[i], ...data };
    return rows[i];
  });
  prisma.school_sso_provider.create.mockImplementation(async ({ data }: any) => {
    rows.push({ updated_at: new Date(), settings: {}, ...data });
    return rows.at(-1);
  });
  const settings = new SsoSettingsService(prisma as any);
  const registry = new SsoRegistry(settings);
  const service = new SchoolSsoService(registry, settings);
  return { service, rows, registry };
}

const byKey = (items: { key: string }[]) => Object.fromEntries(items.map((i) => [i.key, i])) as any;

describe('SignInController', () => {
  test('every route needs a session and an organisation admin', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SignInController)).toBe('organisation');
    expect(Reflect.getMetadata(GUARDS_METADATA, SignInController)).toEqual([
      AuthGuard,
      OrganisationAdminGuard,
    ]);
  });

  test('exposes the contracted routes', () => {
    const seen = Object.getOwnPropertyNames(SignInController.prototype)
      .filter((n) => n !== 'constructor')
      .map((n) => {
        const h = (SignInController.prototype as any)[n];
        return `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, h)]} ${Reflect.getMetadata(PATH_METADATA, h)}`;
      })
      .sort();
    expect(seen).toEqual(
      [
        'GET sign-in/domains',
        'GET schools/:id/sso/providers',
        'PUT schools/:id/sso/providers/:key',
        'GET schools/:id/email-domains',
        'POST schools/:id/email-domains',
        'PATCH schools/:id/email-domains/:domainId',
        'DELETE schools/:id/email-domains/:domainId',
        'POST schools/:id/email-domains/:domainId/verify',
      ].sort(),
    );
  });

  test('the guard refuses someone who is not an organisation admin (403)', async () => {
    const prisma = createMockPrisma();
    const guard = new OrganisationAdminGuard(prisma as any);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-1' } }) }) } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  function controller(
    requireSchool = mock(async () => {}),
    schoolSso: any = { list: mock(async () => []), update: mock(async () => ({})) },
  ) {
    const domains = {
      listAll: mock(async () => []),
      listForSchool: mock(async () => []),
      addToSchool: mock(async () => ({})),
      updateInSchool: mock(async () => ({})),
      removeFromSchool: mock(async () => {}),
      verifyInSchool: mock(async () => ({})),
    };
    const c = new SignInController(schoolSso, domains as any, { requireSchool } as any);
    return { c, domains, requireSchool, schoolSso };
  }

  const req = { user: { id: 'org-admin' } } as any;

  test('per-school domain routes pass the school id through', async () => {
    const { c, domains, requireSchool } = controller();
    await c.schoolDomains(S);
    await c.addSchoolDomain(req, S, { domain: 'riverside.edu', audience: 'staff' });
    await c.updateSchoolDomain(S, D, { autoJoin: true });
    await c.removeSchoolDomain(S, D);
    await c.verifySchoolDomain(S, D);
    expect(requireSchool).toHaveBeenCalledTimes(5);
    expect(domains.listForSchool.mock.calls[0]).toEqual([S] as any);
    expect(domains.addToSchool.mock.calls[0]).toEqual([S, 'org-admin', { domain: 'riverside.edu', audience: 'staff' }] as any);
    expect(domains.updateInSchool.mock.calls[0]).toEqual([S, D, { autoJoin: true }] as any);
    expect(domains.removeFromSchool.mock.calls[0]).toEqual([S, D] as any);
    expect(domains.verifyInSchool.mock.calls[0]).toEqual([S, D] as any);
  });

  test('an unknown school is a 404 and touches no domain', async () => {
    const { c, domains } = controller(
      mock(async () => {
        throw new NotFoundException('School not found');
      }),
    );
    await expect(c.schoolDomains(S)).rejects.toThrow(NotFoundException);
    await expect(c.updateSchoolDomain(S, D, { autoJoin: true })).rejects.toThrow(NotFoundException);
    expect(domains.listForSchool).not.toHaveBeenCalled();
    expect(domains.updateInSchool).not.toHaveBeenCalled();
  });
});

describe('per-school sign-in app routes', () => {
  const req = { user: { id: 'org-admin' } } as any;

  test('organisation admins: any school, by id', async () => {
    const schoolSso = { list: mock(async () => []), update: mock(async () => ({})) };
    const requireSchool = mock(async () => {});
    const c = new SignInController(schoolSso as any, {} as any, { requireSchool } as any);
    await c.schoolProviders(req, S);
    await c.updateSchoolProvider(req, OTHER, 'google', { enabled: false });
    expect(requireSchool.mock.calls).toEqual([[S], [OTHER]] as any);
    expect((schoolSso.list.mock.calls[0] as any[])[0]).toBe(S);
    expect((schoolSso.update.mock.calls[0] as any[]).slice(0, 4)).toEqual([OTHER, 'google', { enabled: false }, 'org-admin']);
  });

  test('organisation admins: an unknown school is a 404 and saves nothing', async () => {
    const schoolSso = { list: mock(async () => []), update: mock(async () => ({})) };
    const requireSchool = mock(async () => {
      throw new NotFoundException('School not found');
    });
    const c = new SignInController(schoolSso as any, {} as any, { requireSchool } as any);
    await expect(c.schoolProviders(req, S)).rejects.toThrow(NotFoundException);
    await expect(c.updateSchoolProvider(req, S, 'google', { enabled: true })).rejects.toThrow(NotFoundException);
    expect(schoolSso.list).not.toHaveBeenCalled();
    expect(schoolSso.update).not.toHaveBeenCalled();
  });

  const proto = SchoolController.prototype as any;

  test('school admins: school:update, on the active school only', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SchoolController)).toEqual([AuthGuard, PermissionGuard]);
    for (const method of ['getSsoProviders', 'updateSsoProvider']) {
      expect(Reflect.getMetadata(PERMISSION_KEY, proto[method])).toBe('school:update');
    }
    expect(Reflect.getMetadata(PATH_METADATA, proto.getSsoProviders)).toBe('current/sso/providers');
    expect(Reflect.getMetadata(PATH_METADATA, proto.updateSsoProvider)).toBe('current/sso/providers/:key');

    // The school comes from the caller's profile, never from the request:
    // an admin of another school can only ever reach their own.
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: OTHER });
    const schoolSso = { list: mock(async () => []), update: mock(async () => ({})) };
    const c = new SchoolController({} as any, {} as any, {} as any, prisma as any, {} as any, {} as any, schoolSso as any);
    await c.getSsoProviders({ user: { id: 'admin-2' } });
    await c.updateSsoProvider({ user: { id: 'admin-2' } }, 'google', { enabled: false });
    expect((schoolSso.list.mock.calls[0] as any[])[0]).toBe(OTHER);
    expect((schoolSso.update.mock.calls[0] as any[]).slice(0, 4)).toEqual([OTHER, 'google', { enabled: false }, 'admin-2']);

    prisma.user_profile.findUnique.mockResolvedValue({ school_id: null });
    await expect(c.getSsoProviders({ user: { id: 'nobody' } })).rejects.toThrow(BadRequestException);
  });
});

describe('SchoolSsoService', () => {
  test("lists each provider as the school has it: env until it saves its own", async () => {
    const { service } = setup();
    const items = byKey(await service.list(S));
    expect(Object.keys(items)).toEqual(['google', 'azure', 'saml']);
    expect(items.google).toMatchObject({
      enabled: true,
      available: true,
      configSource: 'env',
      clientId: 'env-google-id',
      hasSecret: true,
      secretSource: 'env',
      redirectUri: 'https://api.gb.test/api/auth/sso/callback',
      saml: null,
      updatedAt: null,
    });
    expect(items.azure).toMatchObject({ enabled: false, available: false, hasSecret: false, secretSource: null, clientId: null });
    expect(items.saml).toMatchObject({
      label: 'SAML 2.0',
      needsClient: false,
      available: true,
      redirectUri: null,
      saml: {
        metadataUrl: 'https://api.gb.test/api/auth/sso/saml/metadata',
        acsUrl: 'https://api.gb.test/api/auth/sso/saml/acs',
        entityId: 'https://api.gb.test/api/auth/sso/saml/metadata',
      },
    });
  });

  test('a secret is never returned, and is stored bound to the school and provider', async () => {
    const { service, rows } = setup();
    const item = await service.update(
      S,
      'azure',
      { enabled: true, clientId: 'ms-id', clientSecret: 'ms-very-secret' },
      'org-admin',
    );
    expect(JSON.stringify(item)).not.toContain('ms-very-secret');
    const listed = JSON.stringify(await service.list(S));
    expect(listed).not.toContain('ms-very-secret');
    expect(listed).not.toContain('env-google-secret');
    expect(item).toMatchObject({ available: true, hasSecret: true, secretSource: 'school', configSource: 'school', clientId: 'ms-id' });
    expect(rows[0]).toMatchObject({ school_id: S, provider: 'azure' });
    expect(rows[0].client_secret_enc).not.toContain('ms-very-secret');
    expect(decryptSsoSecret({ schoolId: S, provider: 'azure' }, rows[0].client_secret_enc)).toBe('ms-very-secret');
    expect(decryptSsoSecret({ schoolId: OTHER, provider: 'azure' }, rows[0].client_secret_enc)).toBeNull();
  });

  test("one school's app does not change another's", async () => {
    const { service } = setup();
    await service.update(S, 'google', { enabled: false }, 'admin');
    expect(byKey(await service.list(S)).google).toMatchObject({ configSource: 'school', available: false });
    expect(byKey(await service.list(OTHER)).google).toMatchObject({ configSource: 'env', available: true });
  });

  test('enabling without complete credentials is a 400 - the env does not count once the school has its own', async () => {
    const { service, rows } = setup();
    await expect(service.update(S, 'azure', { enabled: true }, 'a')).rejects.toThrow(
      "Add Microsoft's client ID and client secret before turning it on",
    );
    await expect(service.update(S, 'google', { enabled: true, clientId: 'school-id' }, 'a')).rejects.toThrow(
      BadRequestException,
    );
    // A first save without `enabled` starts the school's app switched off.
    const item = await service.update(S, 'google', { clientId: 'school-id' }, 'a');
    expect(item).toMatchObject({ enabled: false, available: false, configSource: 'school', secretSource: null });
    // Clearing the secret of an enabled app is refused too.
    await service.update(S, 'google', { enabled: true, clientSecret: 's' }, 'a');
    await expect(service.update(S, 'google', { clientSecret: '' }, 'a')).rejects.toThrow(BadRequestException);
    expect(rows).toHaveLength(1);
  });

  test('validates per provider', async () => {
    const { service } = setup();
    await expect(service.update(S, 'nope', { enabled: true }, 'a')).rejects.toThrow(NotFoundException);
    await expect(service.update(S, 'google', {}, 'a')).rejects.toThrow('Nothing to update');
    await expect(
      service.update(S, 'azure', { enabled: true, clientId: 'has space', clientSecret: 'x' }, 'a'),
    ).rejects.toThrow('cannot contain spaces');
    await expect(service.update(S, 'saml', { enabled: true }, 'a')).rejects.toThrow('set up on each email domain');
    await expect(service.update(S, 'google', { settings: { entityId: 'x' } }, 'a')).rejects.toThrow('has no setting');
  });
});
