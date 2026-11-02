import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { decryptSsoSecret, encryptSsoSecret } from './sso-secret';
import { SSO_SETTINGS_TTL_MS, SsoSettingsService } from './sso-settings.service';
import { SsoRegistry } from './sso.registry';
import { FLOW_COOKIE, SsoService } from './sso.service';
import type { SsoIdentity } from './sso.types';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

/** A settings service over an in-memory school_sso_provider table. */
function settingsOver(rows: any[] = []) {
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
  // save() inserts with ON CONFLICT DO NOTHING (createMany + skipDuplicates).
  prisma.school_sso_provider.createMany.mockImplementation(async ({ data }: any) => {
    let count = 0;
    for (const r of data) {
      if (rows.some((x) => x.school_id === r.school_id && x.provider === r.provider)) continue;
      rows.push({ updated_at: new Date(), updated_by: null, settings: {}, ...r });
      count++;
    }
    return { count };
  });
  const settings = new SsoSettingsService(prisma as any);
  const registry = new SsoRegistry(settings);
  return { prisma, settings, registry, rows };
}

const row = (over: Record<string, unknown>) => ({
  school_id: A,
  provider: 'google',
  enabled: true,
  client_id: null,
  client_secret_enc: null,
  settings: {},
  updated_at: new Date('2026-11-01T00:00:00Z'),
  updated_by: null,
  ...over,
});

const secretFor = (schoolId: string, plaintext: string, provider = 'google') =>
  encryptSsoSecret({ schoolId, provider }, plaintext);

describe('client secret encryption', () => {
  const owner = { schoolId: A, provider: 'google' };

  test('round-trips, and the stored value is not the plaintext', () => {
    const stored = encryptSsoSecret(owner, 'super-secret');
    expect(stored).not.toContain('super-secret');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(decryptSsoSecret(owner, stored)).toBe('super-secret');
  });

  test('a fresh IV every time', () => {
    expect(encryptSsoSecret(owner, 'x')).not.toBe(encryptSsoSecret(owner, 'x'));
  });

  test("bound to the school and the provider: a copied ciphertext does not decrypt", () => {
    const stored = encryptSsoSecret(owner, 'super-secret');
    expect(decryptSsoSecret({ schoolId: B, provider: 'google' }, stored)).toBeNull();
    expect(decryptSsoSecret({ schoolId: A, provider: 'azure' }, stored)).toBeNull();
  });

  test('unreadable after AUTH_SECRET changes; garbage is null', () => {
    const stored = encryptSsoSecret(owner, 'super-secret');
    process.env.AUTH_SECRET = 'b'.repeat(40);
    expect(decryptSsoSecret(owner, stored)).toBeNull();
    expect(decryptSsoSecret(owner, 'garbage')).toBeNull();
  });
});

describe('per-school resolution', () => {
  test('no row: the school uses the env', async () => {
    const { registry } = settingsOver();
    expect(await registry.resolve('google', A)).toMatchObject({
      source: 'env',
      clientKey: 'env',
      config: { clientId: 'env-google-id', clientSecret: 'env-google-secret' },
    });
  });

  test("a school's own row wins, and only for that school", async () => {
    const { registry } = settingsOver([
      row({ client_id: 'a-id', client_secret_enc: secretFor(A, 'a-secret') }),
    ]);
    expect(await registry.resolve('google', A)).toMatchObject({
      source: 'school',
      clientKey: `school:${A}`,
      config: { clientId: 'a-id', clientSecret: 'a-secret' },
    });
    // School B has no row: the env, never A's app.
    expect(await registry.resolve('google', B)).toMatchObject({
      source: 'env',
      config: { clientId: 'env-google-id' },
    });
    // No school known (no email yet): the env.
    expect(await registry.resolve('google', null)).toMatchObject({ source: 'env' });
  });

  test('with a row, the env never fills a gap or overrides "off"', async () => {
    const { registry } = settingsOver([
      row({ client_id: 'a-id' }), // no secret
      row({ school_id: B, enabled: false }),
    ]);
    expect(await registry.resolve('google', A)).toBeUndefined();
    expect(await registry.resolve('google', B)).toBeUndefined();
    expect((await registry.availableFor(B)).map((p) => p.id)).toEqual(['saml']);
  });

  test('without env credentials, a school with no row has no Google', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const { registry } = settingsOver([
      row({ client_id: 'a-id', client_secret_enc: secretFor(A, 'a-secret') }),
    ]);
    expect(await registry.resolve('google', A)).toBeDefined();
    expect(await registry.resolve('google', B)).toBeUndefined();
    // The login page's buttons follow the env only.
    expect(registry.unscoped()).toEqual([]);
  });

  test("a secret saved for another school (a copied row) does not decrypt", async () => {
    const { settings, registry } = settingsOver([
      row({ school_id: B, client_id: 'a-id', client_secret_enc: secretFor(A, 'a-secret') }),
    ]);
    expect((await settings.forSchool(B)).get('google')).toMatchObject({
      secretStored: true,
      secretUnreadable: true,
      clientSecret: null,
    });
    expect(await registry.resolve('google', B)).toBeUndefined();
  });

  test('copies are reused for the TTL, and a save applies at once', async () => {
    const { prisma, settings, registry, rows } = settingsOver();
    await registry.resolve('google', A);
    await registry.resolve('google', A);
    expect(prisma.school_sso_provider.findMany).toHaveBeenCalledTimes(1);

    await settings.save(A, 'google', { enabled: false }, 'admin-1');
    expect(await registry.resolve('google', A)).toBeUndefined();
    await settings.save(A, 'google', { enabled: true, clientId: 'a-id', clientSecret: 'a-secret' }, 'admin-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].client_secret_enc).not.toContain('a-secret');
    expect(rows[0].updated_by).toBe('admin-1');
    expect((await registry.resolve('google', A))?.config.clientSecret).toBe('a-secret');
    expect(prisma.school_sso_provider.upsert).not.toHaveBeenCalled();
  });

  test('another instance picks a change up once its copy is stale', async () => {
    const { settings, registry, rows } = settingsOver();
    expect(await registry.resolve('google', A)).toBeDefined();
    rows.push(row({ enabled: false }));
    expect(await registry.resolve('google', A)).toBeDefined();
    (settings as any).schools.get(A).loadedAt = Date.now() - SSO_SETTINGS_TTL_MS;
    expect(await registry.resolve('google', A)).toBeUndefined();
  });

  test('a database failure keeps the last copy, and never silently falls back to the env', async () => {
    const { prisma, settings, registry } = settingsOver([row({ enabled: false })]);
    expect(await registry.resolve('google', A)).toBeUndefined();
    prisma.school_sso_provider.findMany.mockRejectedValue(new Error('connection lost'));
    (settings as any).schools.get(A).loadedAt = 0;
    expect(await registry.resolve('google', A)).toBeUndefined();
    await expect(registry.resolve('google', B)).rejects.toThrow('connection lost');
  });
});

// ── sign-in uses the school's own client, start to finish ─────────────────

const domainOf = (schoolId: string, domain: string) => ({
  id: `dom-${schoolId}`,
  schoolId,
  domain,
  audience: 'student',
  autoJoin: true,
  ssoProvider: 'google',
  ssoRequired: false,
  azureTenantId: null,
  samlEntryPoint: null,
  samlIssuer: null,
  samlCertificate: null,
});

function flow(rows: any[]) {
  const { settings, registry } = settingsOver(rows);
  const domains = [domainOf(A, 'a-school.edu'), domainOf(B, 'b-school.edu')];
  const byEmail = async (email?: string | null) =>
    domains.find((d) => email?.endsWith(`@${d.domain}`)) ?? null;
  const google = registry.adapter('google')!;
  const started: any[] = [];
  const completed: any[] = [];
  let signedIn: SsoIdentity | null = null;
  // The real adapter, minus the network: record which client it was handed.
  Object.assign(google, {
    start: mock(async (ctx: any) => {
      started.push(ctx);
      return { url: `https://idp.test/auth?state=${ctx.state}`, secrets: { v: 'x' } };
    }),
    complete: mock(async (ctx: any) => {
      completed.push(ctx);
      return signedIn!;
    }),
  });
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ id: 'u', first_name: 'Kai', school_id: A });
  const sessions = { create: mock(async () => 'token') };
  const service = new SsoService(
    createMockCacheService() as any,
    registry,
    {
      verifiedDomainFor: byEmail,
      verifiedDomainById: async (id: string) => domains.find((d) => d.id === id) ?? null,
      tryAutoJoin: async () => ({ status: 'joined' }),
    } as any,
    prisma as any,
    { userForIdentity: mock(async () => ({ id: 'u', email: 'kai@a-school.edu' })) } as any,
    sessions as any,
  );

  async function begin(email?: string) {
    const reply = {
      cookies: {} as Record<string, string>,
      setCookie: (name: string, value: string) => (reply.cookies[name] = value),
      clearCookie: () => {},
    };
    const req = { url: '/start', cookies: {}, headers: { host: 'api.gb.test' }, protocol: 'https' };
    const url = await service.start(req as any, reply as any, 'google', { email });
    const state = new URL(url).searchParams.get('state')!;
    return { state, flow: reply.cookies[FLOW_COOKIE] };
  }

  async function finish(s: { state: string; flow: string }, who: SsoIdentity) {
    signedIn = who;
    const req = {
      url: `/api/auth/sso/callback?code=c&state=${s.state}`,
      cookies: { [FLOW_COOKIE]: s.flow },
      headers: { host: 'api.gb.test' },
      protocol: 'https',
    };
    const reply = { setCookie: () => {}, clearCookie: () => {} };
    return service.callback(req as any, reply as any, { code: 'c', state: s.state });
  }

  return { service, settings, registry, started, completed, begin, finish, sessions };
}

const kai: SsoIdentity = {
  provider: 'google',
  subject: 'sub-1',
  email: 'kai@a-school.edu',
  emailVerified: true,
  claims: { email_verified: true, hd: 'a-school.edu' },
  profile: { firstName: 'Kai', lastName: 'Joseph', avatarUrl: null },
};

describe('sign-in with per-school apps', () => {
  const aRow = () => row({ client_id: 'a-id', client_secret_enc: secretFor(A, 'a-secret') });

  test("start and callback use the address's school's own client", async () => {
    const f = flow([aRow()]);
    const s = await f.begin('kai@a-school.edu');
    expect(f.started[0]).toMatchObject({
      clientKey: `school:${A}`,
      config: { clientId: 'a-id', clientSecret: 'a-secret' },
    });
    const to = await f.finish(s, kai);
    expect(to).toEndWith('/');
    expect(f.completed[0]).toMatchObject({
      clientKey: `school:${A}`,
      config: { clientId: 'a-id', clientSecret: 'a-secret' },
    });
    expect(f.sessions.create).toHaveBeenCalledTimes(1);
  });

  test("school A's credentials are never used for school B", async () => {
    const f = flow([aRow()]);
    const s = await f.begin('lee@b-school.edu');
    expect(f.started[0]).toMatchObject({ clientKey: 'env', config: { clientId: 'env-google-id' } });
    await f.finish(s, { ...kai, email: 'lee@b-school.edu', claims: { email_verified: true, hd: 'b-school.edu' } });
    expect(f.completed[0]).toMatchObject({ clientKey: 'env', config: { clientId: 'env-google-id' } });
    for (const ctx of [...f.started, ...f.completed]) {
      expect(JSON.stringify(ctx.config)).not.toContain('a-secret');
    }
  });

  test('the pending state carries the school id and whose client started it', async () => {
    const f = flow([aRow()]);
    const { state } = await f.begin('kai@a-school.edu');
    const pending = await (f.service as any).cache.get(`sso-state:${state}`);
    expect(pending).toMatchObject({ provider: 'google', schoolId: A, configSource: 'school' });
    const anon = await f.begin();
    expect(await (f.service as any).cache.get(`sso-state:${anon.state}`)).toMatchObject({
      schoolId: null,
      configSource: 'env',
    });
  });

  test("a school that turns its app off mid sign-in: the callback refuses", async () => {
    const f = flow([aRow()]);
    const s = await f.begin('kai@a-school.edu');
    await f.settings.save(A, 'google', { enabled: false }, 'admin');
    expect(await f.finish(s, kai)).toContain('/login?error=provider');
    expect(f.completed).toEqual([]);
  });

  test('a school that saves its own app after an env start: the callback refuses', async () => {
    const f = flow([]);
    const s = await f.begin('kai@a-school.edu');
    await f.settings.save(A, 'google', { enabled: true, clientId: 'a-id', clientSecret: 'a-secret' }, 'admin');
    expect(await f.finish(s, kai)).toContain('/login?error=provider');
    expect(f.completed).toEqual([]);
  });

  test("discovery offers a domain's provider from its own school's settings", async () => {
    const f = flow([row({ school_id: B, enabled: false })]);
    expect(await f.service.discover('kai@a-school.edu')).toMatchObject({ provider: { id: 'google' } });
    // B switched Google off for itself; the env does not override that.
    expect(await f.service.discover('lee@b-school.edu')).toEqual({ provider: null, required: false });
    await expect(f.begin('lee@b-school.edu')).rejects.toThrow('not available');
  });
});
