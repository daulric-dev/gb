import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { startFakeOidcIdp, type FakeOidcIdp } from '@/test/oidc-idp';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { SchoolController } from '@/school/school.controller';
import { SignInController } from '@/organisation/sign-in.controller';
import {
  CustomOidcAdapter,
  normalizeIssuer,
  sameIssuer,
} from './adapters/custom-oidc.adapter';
import { encryptSsoSecret } from './sso-secret';
import { SsoSettingsService } from './sso-settings.service';
import { SsoRegistry } from './sso.registry';
import { FLOW_COOKIE, SsoService } from './sso.service';
import { SchoolSsoService, appSaveEntries } from './school-sso.service';
import { SsoAuditService } from './sso-audit.service';
import { isAlerting } from './sso-alert.service';
import type { SsoIdentity } from './sso.types';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = { id: 'admin-1', via: 'school_admin' as const };

const savedEnv = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});
beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
  delete process.env.DATA_ENCRYPTION_KEY;
  process.env.API_URL = 'https://api.gb.test';
  delete process.env.SSO_PROVIDERS;
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
});

let idpA: FakeOidcIdp;
let idpB: FakeOidcIdp;
beforeAll(() => {
  idpA = startFakeOidcIdp({ path: '/realms/a' });
  idpB = startFakeOidcIdp({ path: '/realms/b' });
});
afterAll(() => {
  idpA.stop();
  idpB.stop();
});

/** A school's saved `oidc` row. */
const oidcRow = (schoolId: string, settings: Record<string, string>, over: Record<string, unknown> = {}) => ({
  school_id: schoolId,
  provider: 'oidc',
  enabled: true,
  client_id: `${schoolId}-client`,
  client_secret_enc: encryptSsoSecret({ schoolId, provider: 'oidc' }, `${schoolId}-secret`),
  settings,
  updated_at: new Date('2026-11-01T00:00:00Z'),
  updated_by: null,
  ...over,
});

/** The settings and registry over an in-memory school_sso_provider table. */
function settingsOver(rows: any[]) {
  const prisma = createMockPrisma();
  const match = (r: any, w: any) =>
    r.school_id === w.school_id_provider.school_id && r.provider === w.school_id_provider.provider;
  prisma.school_sso_provider.findMany.mockImplementation(async ({ where }: any) =>
    rows.filter((r) => r.school_id === where.school_id).map((r) => ({ ...r })),
  );
  const tx = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  tx.school_sso_provider.findUnique.mockImplementation(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null);
  tx.school_sso_provider.update.mockImplementation(async ({ where, data }: any) => {
    const i = rows.findIndex((r) => match(r, where));
    rows[i] = { ...rows[i], ...data };
    return rows[i];
  });
  tx.school_sso_provider.createMany.mockImplementation(async ({ data }: any) => {
    rows.push(...data.map((r: any) => ({ updated_at: new Date(), settings: {}, ...r })));
    return { count: data.length };
  });
  const settings = new SsoSettingsService(prisma as any);
  return { settings, registry: new SsoRegistry(settings), tx, rows };
}

const domainOf = (schoolId: string, domain: string, ssoProvider: string | null = 'oidc') => ({
  id: `dom-${schoolId}`,
  schoolId,
  domain,
  audience: 'student',
  autoJoin: true,
  ssoProvider,
  ssoRequired: false,
  azureTenantId: null,
  samlEntryPoint: null,
  samlIssuer: null,
  samlCertificate: null,
});

/** SsoService with the real custom OIDC adapter against the fake issuers. */
function flow(rows: any[], domains = [domainOf(A, 'a-school.edu'), domainOf(B, 'b-school.edu')]) {
  const { registry, settings } = settingsOver(rows);
  const byEmail = async (email?: string | null) =>
    domains.find((d) => email?.toLowerCase().endsWith(`@${d.domain}`)) ?? null;
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ id: 'u', first_name: 'Kai', school_id: null });
  const accounts = {
    userForIdentity: mock(async (id: any) => ({ id: 'u', email: id.email })),
  };
  const tryAutoJoin = mock(async () => ({ status: 'joined' }));
  const sessions = { create: mock(async () => 'token') };
  const service = new SsoService(
    createMockCacheService() as any,
    registry,
    {
      verifiedDomainFor: byEmail,
      verifiedDomainById: async (id: string) => domains.find((d) => d.id === id) ?? null,
      tryAutoJoin,
    } as any,
    prisma as any,
    accounts as any,
    sessions as any,
  );
  const req = (url: string, cookies: Record<string, string> = {}) =>
    ({ url, cookies, headers: { host: 'api.gb.test' }, protocol: 'https' }) as any;

  async function begin(email: string) {
    const reply = {
      cookies: {} as Record<string, string>,
      setCookie: (name: string, value: string) => (reply.cookies[name] = value),
      clearCookie: () => {},
    };
    const url = new URL(await service.start(req('/start'), reply as any, 'oidc', { email }));
    return {
      url,
      state: url.searchParams.get('state')!,
      nonce: url.searchParams.get('nonce')!,
      flow: reply.cookies[FLOW_COOKIE],
    };
  }

  async function finish(s: { state: string; flow: string }, code: string) {
    const query = { code, state: s.state };
    const reply = { setCookie: () => {}, clearCookie: () => {} };
    return service.callback(
      req(`/api/auth/sso/callback?${new URLSearchParams(query)}`, { [FLOW_COOKIE]: s.flow }),
      reply as any,
      query,
    );
  }

  return { service, registry, settings, accounts, tryAutoJoin, sessions, begin, finish };
}

/** School A on idpA (http on loopback: the private-network switch is on). */
const aSettings = () => ({
  displayName: 'Riverside ID',
  issuer: idpA.issuer,
  allowPrivateNetwork: 'true',
});

describe('custom OpenID Connect: settings', () => {
  const adapter = new CustomOidcAdapter();

  test('issuer: https or http URL, trimmed, discovery URL cut back, no credentials / query / fragment', () => {
    expect(normalizeIssuer(' https://ID.Example.edu/ ')).toBe('https://id.example.edu');
    expect(normalizeIssuer('https://kc.example.edu/realms/school/.well-known/openid-configuration')).toBe(
      'https://kc.example.edu/realms/school',
    );
    expect(normalizeIssuer('https://tenant.auth0.example/')).toBe('https://tenant.auth0.example');
    for (const bad of ['ftp://x.edu', 'https://u:p@x.edu', 'https://x.edu/?a=1', 'https://x.edu/#f', 'not a url', '']) {
      expect(normalizeIssuer(bad)).toBeNull();
    }
    expect(sameIssuer('https://id.example.edu', 'https://id.example.edu/')).toBe(true);
    expect(sameIssuer('https://id.example.edu/a', 'https://id.example.edu/a/')).toBe(false);
  });

  test('each field is normalised or refused with a message', () => {
    expect(adapter.normalizeSetting('displayName', '  Riverside   ID ')).toBe('Riverside ID');
    expect(() => adapter.normalizeSetting('displayName', 'x'.repeat(61))).toThrow(BadRequestException);
    expect(() => adapter.normalizeSetting('displayName', 'a\u0007b')).toThrow(BadRequestException);
    expect(adapter.normalizeSetting('issuer', 'https://id.example.edu/')).toBe('https://id.example.edu');
    expect(() => adapter.normalizeSetting('issuer', 'https://u:p@id.example.edu')).toThrow(BadRequestException);
    expect(adapter.normalizeSetting('emailClaim', 'upn')).toBe('upn');
    // The default is stored as nothing.
    expect(adapter.normalizeSetting('emailClaim', 'email')).toBe('');
    expect(() => adapter.normalizeSetting('emailClaim', 'sub')).toThrow(BadRequestException);
    expect(adapter.normalizeSetting('scope', ' groups  openid offline_access groups ')).toBe('groups offline_access');
    expect(() => adapter.normalizeSetting('scope', 'a"b')).toThrow(BadRequestException);
    expect(adapter.normalizeSetting('allowPrivateNetwork', 'true')).toBe('true');
    expect(adapter.normalizeSetting('allowPrivateNetwork', 'false')).toBe('');
    expect(() => adapter.normalizeSetting('allowPrivateNetwork', 'yes')).toThrow(BadRequestException);
  });

  test('a private, loopback or link-local issuer is refused unless the private-network switch is on', async () => {
    const dns = mock(async (host: string) =>
      host === 'metadata.evil.test'
        ? [{ address: '169.254.169.254', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
    );
    const a = new CustomOidcAdapter(undefined, dns);
    for (const issuer of ['https://10.1.2.3', 'https://127.0.0.1:8443/realms/x', 'https://metadata.evil.test', 'https://[::1]']) {
      await expect(a.checkSettings({ issuer }, true)).rejects.toThrow('private or reserved');
      await expect(a.checkSettings({ issuer, allowPrivateNetwork: 'true' }, true)).resolves.toBeUndefined();
    }
    await expect(a.checkSettings({ issuer: 'https://id.example.edu' }, true)).resolves.toBeUndefined();
    // http only on the private network.
    await expect(a.checkSettings({ issuer: 'http://id.example.edu' }, true)).rejects.toThrow('https');
    await expect(
      a.checkSettings({ issuer: 'http://id.example.edu', allowPrivateNetwork: 'true' }, true),
    ).resolves.toBeUndefined();
    // Cannot be turned on without an issuer.
    await expect(a.checkSettings({}, true)).rejects.toThrow('issuer');
    await expect(a.checkSettings({}, false)).resolves.toBeUndefined();
  });

  test('no install-wide fallback: available only with a school\'s client, secret and issuer', () => {
    expect(adapter.envConfig()).toEqual({ enabled: false, clientId: null, clientSecret: null, settings: {} });
    const config = { enabled: true, clientId: 'c', clientSecret: 's', settings: { issuer: 'https://id.example.edu' } };
    expect(adapter.available(config)).toBe(true);
    expect(adapter.available({ ...config, settings: {} })).toBe(false);
    expect(adapter.available({ ...config, clientSecret: null })).toBe(false);
    // http without the private-network switch is not usable.
    expect(adapter.available({ ...config, settings: { issuer: 'http://id.example.edu' } })).toBe(false);
    expect(adapter.labelFor(config)).toBe('your school account');
    expect(adapter.labelFor({ ...config, settings: { displayName: 'Riverside ID' } })).toBe('Riverside ID');
  });

  test('without its own row a school has no custom provider, and it is never a login button', async () => {
    const { registry } = settingsOver([]);
    expect(await registry.resolve('oidc', A)).toBeUndefined();
    expect(registry.unscoped().map((p) => p.id)).not.toContain('oidc');
  });
});

describe('custom OpenID Connect: sign-in against a fake issuer', () => {
  test('happy path: discovery, code exchange, school-namespaced subject, vouched, joined', async () => {
    const f = flow([oidcRow(A, aSettings())]);
    expect(await f.service.discover('kai@a-school.edu')).toEqual({
      provider: { id: 'oidc', label: 'Riverside ID', kind: 'oauth' },
      required: false,
    });
    const s = await f.begin('kai@a-school.edu');
    expect(s.url.origin + s.url.pathname).toBe(`${idpA.issuer}/authorize`);
    expect(s.url.searchParams.get('client_id')).toBe(`${A}-client`);
    expect(s.url.searchParams.get('scope')).toBe('openid email profile');
    expect(s.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(s.url.searchParams.get('login_hint')).toBe('kai@a-school.edu');

    const code = idpA.codeFor({
      sub: 'u-123',
      email: 'Kai@A-School.edu',
      email_verified: true,
      given_name: 'Kai',
      nonce: s.nonce,
    });
    const to = await f.finish(s, code);
    expect(to).not.toContain('error=');
    expect(idpA.tokenRequests.at(-1)).toMatchObject({ client_id: `${A}-client`, client_secret: `${A}-secret` });

    const [identity, trusted] = f.accounts.userForIdentity.mock.calls[0] as any[];
    expect(identity.provider).toBe('oidc');
    expect(identity.subject).toMatch(new RegExp(`^${A}:[0-9a-f]{16}:u-123$`));
    expect(identity.email).toBe('kai@a-school.edu');
    expect(trusted).toBe(true);
    expect(f.tryAutoJoin).toHaveBeenCalledTimes(1);
    expect(f.sessions.create).toHaveBeenCalledTimes(1);
  });

  test('extra scopes are requested on top of the base ones', async () => {
    const f = flow([oidcRow(A, { ...aSettings(), scope: 'groups offline_access' })]);
    const s = await f.begin('kai@a-school.edu');
    expect(s.url.searchParams.get('scope')).toBe('openid email profile groups offline_access');
  });

  test('an ID token from another issuer is refused', async () => {
    const f = flow([oidcRow(A, aSettings())]);
    const s = await f.begin('kai@a-school.edu');
    const code = idpA.codeFor({ sub: 'u-1', email: 'kai@a-school.edu', email_verified: true, nonce: s.nonce, iss: idpB.issuer });
    expect(await f.finish(s, code)).toContain('/login?error=expired');
    expect(f.accounts.userForIdentity).not.toHaveBeenCalled();
  });

  test('a discovery document naming another issuer is refused at start', async () => {
    const liar = startFakeOidcIdp({ discoveredIssuer: idpB.issuer });
    try {
      const f = flow([oidcRow(A, { issuer: liar.issuer, allowPrivateNetwork: 'true' })]);
      await expect(f.begin('kai@a-school.edu')).rejects.toThrow('Could not start sign-in with your school account');
    } finally {
      liar.stop();
    }
  });

  test('a token signed by a key not in the issuer\'s JWKS is refused', async () => {
    const forger = startFakeOidcIdp({ wrongKey: true });
    try {
      const f = flow([oidcRow(A, { issuer: forger.issuer, allowPrivateNetwork: 'true' })]);
      const s = await f.begin('kai@a-school.edu');
      const code = forger.codeFor({ sub: 'u-1', email: 'kai@a-school.edu', email_verified: true, nonce: s.nonce });
      expect(await f.finish(s, code)).toContain('/login?error=expired');
    } finally {
      forger.stop();
    }
  });

  test('an unverified email signs in but is not trusted (no school, no linking)', async () => {
    const f = flow([oidcRow(A, aSettings())]);
    const s = await f.begin('kai@a-school.edu');
    const code = idpA.codeFor({ sub: 'u-2', email: 'kai@a-school.edu', email_verified: false, nonce: s.nonce });
    await f.finish(s, code);
    const [, trusted] = f.accounts.userForIdentity.mock.calls[0] as any[];
    expect(trusted).toBe(false);
    expect(f.tryAutoJoin).not.toHaveBeenCalled();
  });

  test('an address off the school\'s domains (even a verified one) is not trusted', async () => {
    const f = flow([oidcRow(A, aSettings())]);
    const s = await f.begin('kai@a-school.edu');
    const code = idpA.codeFor({ sub: 'u-3', email: 'victim@gmail.com', email_verified: true, nonce: s.nonce });
    await f.finish(s, code);
    const [identity, trusted] = f.accounts.userForIdentity.mock.calls[0] as any[];
    expect(identity.email).toBe('victim@gmail.com');
    expect(trusted).toBe(false);
  });

  test("school A's issuer cannot vouch for school B's domain", async () => {
    const f = flow([oidcRow(A, aSettings()), oidcRow(B, { issuer: idpB.issuer, allowPrivateNetwork: 'true' })]);
    const s = await f.begin('kai@a-school.edu');
    // A's IdP asserts a verified address on B's domain.
    const code = idpA.codeFor({ sub: 'u-4', email: 'lee@b-school.edu', email_verified: true, nonce: s.nonce });
    await f.finish(s, code);
    const [identity, trusted] = f.accounts.userForIdentity.mock.calls[0] as any[];
    expect(identity.subject.startsWith(`${A}:`)).toBe(true);
    expect(trusted).toBe(false);
    expect(f.tryAutoJoin).not.toHaveBeenCalled();
  });

  test('the same sub at two schools is two identities', () => {
    const adapter = new CustomOidcAdapter();
    const claims = { sub: 'same', email: 'x@a-school.edu', email_verified: true };
    const a = adapter.schoolIdentity(claims, A, idpA.issuer, 'email');
    const b = adapter.schoolIdentity(claims, B, idpB.issuer, 'email');
    const aMoved = adapter.schoolIdentity(claims, A, idpB.issuer, 'email');
    expect(new Set([a.subject, b.subject, aMoved.subject]).size).toBe(3);
  });

  test('an issuer changed mid sign-in is refused', async () => {
    const rows = [oidcRow(A, aSettings())];
    const f = flow(rows);
    const s = await f.begin('kai@a-school.edu');
    await f.settings.save(A, 'oidc', { enabled: true, settings: { ...aSettings(), issuer: idpB.issuer } }, 'admin');
    const code = idpA.codeFor({ sub: 'u-5', email: 'kai@a-school.edu', email_verified: true, nonce: s.nonce });
    expect(await f.finish(s, code)).toContain('/login?error=expired');
    expect(f.accounts.userForIdentity).not.toHaveBeenCalled();
  });

  test('a loopback issuer is never contacted without the private-network switch', async () => {
    const watched = startFakeOidcIdp();
    try {
      // https on 127.0.0.1: usable config, but the fetch refuses the address.
      const issuer = watched.issuer.replace('http:', 'https:');
      const f = flow([oidcRow(A, { issuer })]);
      await expect(f.begin('kai@a-school.edu')).rejects.toThrow('Could not start sign-in');
      // http without the switch: not available at all.
      const g = flow([oidcRow(A, { issuer: watched.issuer })]);
      expect(await g.service.discover('kai@a-school.edu')).toEqual({ provider: null, required: false });
      await expect(g.begin('kai@a-school.edu')).rejects.toThrow('not available');
      expect(watched.requests).toEqual([]);
    } finally {
      watched.stop();
    }
  });

  test('WEBHOOK_ALLOW_PRIVATE does not open private issuers for sign-in', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    const watched = startFakeOidcIdp();
    try {
      const f = flow([oidcRow(A, { issuer: watched.issuer.replace('http:', 'https:') })]);
      await expect(f.begin('kai@a-school.edu')).rejects.toThrow('Could not start sign-in');
      expect(watched.requests).toEqual([]);
    } finally {
      watched.stop();
    }
  });
});

describe('custom OpenID Connect: vouching', () => {
  const adapter = new CustomOidcAdapter();
  const id = (claims: Record<string, unknown>, emailClaim: 'email' | 'upn' | 'preferred_username' = 'email', school = A): SsoIdentity =>
    adapter.schoolIdentity({ sub: 's', ...claims }, school, 'https://id.a-school.edu', emailClaim);
  const ctx = (over: Record<string, unknown> = {}) => ({
    domain: 'a-school.edu',
    azureTenantId: null,
    schoolId: A,
    ssoProvider: 'oidc',
    ...over,
  });

  test('email claim: verified, on the domain, from the domain\'s own school', () => {
    const ok = id({ email: 'kai@a-school.edu', email_verified: true });
    expect(adapter.vouchesForDomain(ok, ctx())).toBe(true);
    // Also for a domain of that school set to another provider.
    expect(adapter.vouchesForDomain(ok, ctx({ ssoProvider: null }))).toBe(true);
    expect(adapter.vouchesForDomain(ok, ctx({ schoolId: B }))).toBe(false);
    expect(adapter.vouchesForDomain(ok, ctx({ schoolId: undefined }))).toBe(false);
    expect(adapter.vouchesForDomain(ok, ctx({ domain: 'other.edu' }))).toBe(false);
    expect(adapter.vouchesForDomain(id({ email: 'kai@a-school.edu', email_verified: 'true' }), ctx())).toBe(false);
    expect(adapter.vouchesForDomain(id({ email: 'kai@a-school.edu' }), ctx())).toBe(false);
    // Another provider's identity, or one not checked under a school.
    expect(adapter.vouchesForDomain({ ...ok, provider: 'google' }, ctx())).toBe(false);
    expect(adapter.vouchesForDomain({ ...ok, verifiedForSchool: undefined }, ctx())).toBe(false);
    expect(adapter.verifiesEmail()).toBe(false);
  });

  test('preferred_username / upn: only for a domain explicitly set to this provider', () => {
    for (const claim of ['preferred_username', 'upn'] as const) {
      const u = id({ [claim]: 'Kai@A-School.edu' }, claim);
      expect(u.email).toBe('kai@a-school.edu');
      expect(u.emailVerified).toBe(false);
      expect(adapter.vouchesForDomain(u, ctx())).toBe(true);
      expect(adapter.vouchesForDomain(u, ctx({ ssoProvider: 'saml' }))).toBe(false);
      expect(adapter.vouchesForDomain(u, ctx({ ssoProvider: null }))).toBe(false);
      expect(adapter.vouchesForDomain(u, ctx({ schoolId: B }))).toBe(false);
    }
    // The email claim is ignored when another is configured.
    expect(id({ email: 'kai@a-school.edu', email_verified: true }, 'upn').email).toBeNull();
  });
});

describe('custom OpenID Connect: saving, audit and alerts', () => {
  function apps(rows: any[] = []) {
    const { settings, registry, tx } = settingsOver(rows);
    const alerts = { notify: mock(async () => {}) };
    const service = new SchoolSsoService(registry, settings, new SsoAuditService(createMockPrisma() as any), alerts as any);
    const logged = () => tx.sso_audit_log.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
    return { service, rows, logged, alerts };
  }

  test('listed for every school with its fields, button label and redirect URI', async () => {
    const { service } = apps([oidcRow(A, { displayName: 'Riverside ID', issuer: 'https://id.example.edu' })]);
    const list = await service.list(A);
    expect(list.map((p) => p.key)).toEqual(['google', 'azure', 'oidc', 'saml']);
    const item = list.find((p) => p.key === 'oidc')!;
    expect(item).toMatchObject({
      label: 'Custom OpenID Connect',
      buttonLabel: 'Riverside ID',
      kind: 'oauth',
      needsClient: true,
      available: true,
      configSource: 'school',
      redirectUri: 'https://api.gb.test/api/auth/sso/callback',
    });
    expect(item.settingFields.map((f) => f.key)).toEqual([
      'displayName',
      'issuer',
      'emailClaim',
      'scope',
      'allowPrivateNetwork',
    ]);
    expect(JSON.stringify(item)).not.toContain(`${A}-secret`);
  });

  test('turning it on needs credentials and an issuer; a private issuer is refused', async () => {
    const { service } = apps();
    await expect(
      service.update(A, 'oidc', { enabled: true, settings: { issuer: 'https://93.184.216.34' } }, ADMIN),
    ).rejects.toThrow('client ID and client secret');
    await expect(
      service.update(A, 'oidc', { enabled: true, clientId: 'c', clientSecret: 's' }, ADMIN),
    ).rejects.toThrow('issuer');
    await expect(
      service.update(A, 'oidc', { settings: { issuer: 'https://192.168.1.10' } }, ADMIN),
    ).rejects.toThrow('private or reserved');
    await expect(
      service.update(A, 'oidc', { settings: { issuer: 'http://192.168.1.10', allowPrivateNetwork: 'true' } }, ADMIN),
    ).resolves.toMatchObject({ settings: { issuer: 'http://192.168.1.10', allowPrivateNetwork: 'true' } });
    await expect(
      service.update(A, 'oidc', { settings: { nope: 'x' } }, ADMIN),
    ).rejects.toThrow('has no setting');
  });

  test('an issuer change is logged with before/after and alerts; the secret never appears', async () => {
    const { service, logged, alerts } = apps();
    await service.update(
      A,
      'oidc',
      {
        enabled: true,
        clientId: 'c-1',
        clientSecret: 'very-secret-value',
        settings: { displayName: 'Riverside ID', issuer: 'https://10.0.0.5/realms/a', allowPrivateNetwork: 'true' },
      },
      ADMIN,
    );
    const first = logged();
    expect(first.map((e: any) => e.action).sort()).toEqual(['app_changed', 'app_enabled', 'app_secret_changed']);
    const changed = first.find((e: any) => e.action === 'app_changed').changes;
    expect(changed).toMatchObject({
      app: 'oidc',
      clientId: { before: null, after: 'c-1' },
      issuer: { before: null, after: 'https://10.0.0.5/realms/a' },
      displayName: { before: null, after: 'Riverside ID' },
      allowPrivateNetwork: { before: null, after: 'true' },
    });

    await service.update(A, 'oidc', { settings: { issuer: 'https://10.0.0.6/realms/a' } }, ADMIN);
    const later = logged().slice(first.length);
    expect(later).toHaveLength(1);
    expect(later[0].action).toBe('app_changed');
    expect(later[0].changes).toEqual({
      app: 'oidc',
      issuer: { before: 'https://10.0.0.5/realms/a', after: 'https://10.0.0.6/realms/a' },
    });
    expect(isAlerting({ action: 'app_changed', changes: later[0].changes })).toBe(true);
    expect(alerts.notify).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logged())).not.toContain('very-secret-value');
  });

  test('appSaveEntries: switching off counts as a change of where people sign in', () => {
    const before = { enabled: true, clientId: 'c', secretStored: true, settings: { issuer: 'https://id.example.edu' } };
    const entries = appSaveEntries('oidc', before, { enabled: false });
    expect(entries).toEqual([{ action: 'app_disabled', changes: { app: 'oidc', enabled: { before: true, after: false } } }]);
    expect(entries.every(isAlerting)).toBe(true);
  });

  test('the save route takes any provider key and needs a step-up confirmation (both consoles)', () => {
    const school = (SchoolController.prototype as any).updateSsoProvider;
    const org = (SignInController.prototype as any).updateSchoolProvider;
    expect(Reflect.getMetadata(PATH_METADATA, school)).toBe('current/sso/providers/:key');
    expect(Reflect.getMetadata(PATH_METADATA, org)).toBe('schools/:id/sso/providers/:key');
    expect(Reflect.getMetadata(STEP_UP_KEY, school)).toBe(true);
    expect(Reflect.getMetadata(STEP_UP_KEY, org)).toBe(true);
  });
});
