import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { OTHER_IDP, TEST_IDP, buildSamlResponse } from '@/test/saml-idp';
import { GoogleAdapter } from './adapters/google.adapter';
import { AzureAdapter } from './adapters/azure.adapter';
import { SamlAdapter, normalizeCertificate } from './adapters/saml.adapter';
import { standardProfile } from './adapters/profile';
import { SsoRegistry } from './sso.registry';
import { samlAcsUrl, samlEntityId } from './sso.config';
import { FLOW_COOKIE, OUTDATED_APP_MESSAGE, safeNext, SsoService } from './sso.service';
import type { SsoAdapter, SsoDomainConfig, SsoIdentity } from './sso.types';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const IDP_ISSUER = 'https://idp.srmss.edu.gd/saml';

const savedEnv = { ...process.env };
beforeAll(() => {
  process.env.API_URL = 'https://api.gb.test';
  process.env.SSO_PROVIDERS = 'google,azure,saml';
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.MICROSOFT_CLIENT_ID = 'ms-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
  delete process.env.SAML_SP_ENTITY_ID;
});
afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

function identity(
  provider: string,
  email: string | null,
  claims: Record<string, unknown>,
  extra: Partial<SsoIdentity> = {},
): SsoIdentity {
  return {
    provider,
    subject: 'sub-1',
    email,
    emailVerified: claims.email_verified === true,
    claims,
    profile: { firstName: null, lastName: null, avatarUrl: null },
    ...extra,
  };
}

const ctx = (domain: string, azureTenantId: string | null = null) => ({
  domain,
  azureTenantId,
});

const samlDomain = (over: Partial<SsoDomainConfig> = {}): SsoDomainConfig => ({
  id: 'dom-saml',
  domain: 'srmss.edu.gd',
  azureTenantId: null,
  samlEntryPoint: 'https://idp.srmss.edu.gd/sso',
  samlIssuer: IDP_ISSUER,
  samlCertificate: TEST_IDP.cert,
  ...over,
});

describe('registry', () => {
  test('lists only adapters this deployment configured', () => {
    expect(new SsoRegistry().enabled().map((p) => p.id)).toEqual(['google', 'azure', 'saml']);
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      // No credentials, no Google; SAML needs nothing until a school sets it up.
      expect(new SsoRegistry().enabled().map((p) => p.id)).toEqual(['azure', 'saml']);
    } finally {
      process.env.GOOGLE_CLIENT_SECRET = secret;
    }
  });
});

describe('GoogleAdapter', () => {
  const google = new GoogleAdapter();

  test('a Workspace account on the domain is vouched for', () => {
    const u = identity('google', 'kai@srmss.edu.gd', { email_verified: true, hd: 'srmss.edu.gd' });
    expect(google.vouchesForDomain(u, ctx('srmss.edu.gd'))).toBe(true);
  });

  test('a subdomain under the Workspace domain counts', () => {
    const u = identity('google', 'kai@students.srmss.edu.gd', {
      email_verified: true,
      hd: 'srmss.edu.gd',
    });
    expect(google.vouchesForDomain(u, ctx('students.srmss.edu.gd'))).toBe(true);
  });

  test('no hosted domain (a personal Google account) is not', () => {
    const u = identity('google', 'kai@srmss.edu.gd', { email_verified: true });
    expect(google.vouchesForDomain(u, ctx('srmss.edu.gd'))).toBe(false);
  });

  test('another Workspace, or an unverified email, is not', () => {
    const other = identity('google', 'kai@srmss.edu.gd', { email_verified: true, hd: 'smss.edu.gd' });
    const unverified = identity('google', 'kai@srmss.edu.gd', { email_verified: false, hd: 'srmss.edu.gd' });
    expect(google.vouchesForDomain(other, ctx('srmss.edu.gd'))).toBe(false);
    expect(google.vouchesForDomain(unverified, ctx('srmss.edu.gd'))).toBe(false);
  });

  test('Gmail addresses are verified for linking but vouch for no school', () => {
    const gmail = identity('google', 'kai@gmail.com', { email_verified: true });
    const elsewhere = identity('google', 'kai@yahoo.com', { email_verified: true });
    expect(google.verifiesEmail(gmail)).toBe(true);
    expect(google.verifiesEmail(elsewhere)).toBe(false);
    expect(google.vouchesForDomain(gmail, ctx('gmail.com'))).toBe(false);
  });

  test('identity from ID token claims', () => {
    const id = google.identityFrom({
      sub: '1234',
      email: 'Kai@SRMSS.edu.gd',
      email_verified: true,
      given_name: 'Kai',
      family_name: 'Joseph',
      picture: 'https://lh3.googleusercontent.com/a/x',
    });
    expect(id).toMatchObject({
      provider: 'google',
      subject: '1234',
      email: 'kai@srmss.edu.gd',
      emailVerified: true,
      profile: { firstName: 'Kai', lastName: 'Joseph' },
    });
    expect(() => google.identityFrom({ email: 'a@b.cd' })).toThrow();
  });
});

describe('AzureAdapter', () => {
  const azure = new AzureAdapter();

  test('the school tenant vouches', () => {
    const u = identity('azure', 'kai@srmss.edu.gd', {
      tid: TENANT,
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    });
    expect(azure.vouchesForDomain(u, ctx('srmss.edu.gd', TENANT))).toBe(true);
    expect(azure.vouchesForDomain(u, ctx('srmss.edu.gd', TENANT.toUpperCase()))).toBe(true);
  });

  test('another tenant claiming the address does not (nOAuth)', () => {
    const other = '00000000-0000-0000-0000-000000000001';
    const u = identity('azure', 'kai@srmss.edu.gd', {
      tid: other,
      iss: `https://login.microsoftonline.com/${other}/v2.0`,
    });
    expect(azure.vouchesForDomain(u, ctx('srmss.edu.gd', TENANT))).toBe(false);
    // Even a forged tid does not beat the issuer the token was checked against.
    const mixed = identity('azure', 'kai@srmss.edu.gd', {
      tid: TENANT,
      iss: `https://login.microsoftonline.com/${other}/v2.0`,
    });
    expect(azure.vouchesForDomain(mixed, ctx('srmss.edu.gd', TENANT))).toBe(false);
  });

  test('without a tenant on the domain, or off the domain, nothing is vouched for', () => {
    const u = identity('azure', 'kai@srmss.edu.gd', { tid: TENANT });
    expect(azure.vouchesForDomain(u, ctx('srmss.edu.gd', null))).toBe(false);
    const off = identity('azure', 'kai@other.edu', { tid: TENANT });
    expect(azure.vouchesForDomain(off, ctx('srmss.edu.gd', TENANT))).toBe(false);
  });

  test('the sign-in name stands in for a missing email claim', () => {
    const id = azure.identityFrom({ sub: 's', tid: TENANT, preferred_username: 'Kai@srmss.edu.gd' });
    expect(id.email).toBe('kai@srmss.edu.gd');
  });

  test('cannot start without the school tenant', async () => {
    const start = (domain: SsoDomainConfig | null) =>
      azure.start({ state: 's', redirectUri: 'https://api.gb.test/cb', domain });
    await expect(start(null)).rejects.toThrow('Enter your school email to sign in with Microsoft');
    await expect(start(samlDomain({ azureTenantId: null }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SamlAdapter', () => {
  const saml = new SamlAdapter();

  async function started(domain = samlDomain()) {
    const s = await saml.start({ state: 'state-1', redirectUri: '', domain });
    return s;
  }

  function response(requestId: string, over: Record<string, unknown> = {}) {
    return buildSamlResponse({
      issuer: IDP_ISSUER,
      audience: samlEntityId(),
      acsUrl: samlAcsUrl(),
      inResponseTo: requestId,
      nameId: 'kai@srmss.edu.gd',
      attributes: {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Kai',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': 'Joseph',
      },
      ...over,
    });
  }

  const complete = (secrets: Record<string, string>, samlResponse: string, domain = samlDomain()) =>
    saml.complete({ state: 'state-1', secrets, domain, samlResponse });

  test('start redirects to the IdP with an AuthnRequest and RelayState', async () => {
    const s = await started();
    const url = new URL(s.url);
    expect(url.origin + url.pathname).toBe('https://idp.srmss.edu.gd/sso');
    expect(url.searchParams.get('SAMLRequest')).toBeTruthy();
    expect(url.searchParams.get('RelayState')).toBe('state-1');
    expect(s.secrets.requestId).toMatch(/^_/);
    expect(s.secrets.domainId).toBe('dom-saml');
  });

  test('start needs a configured school domain', async () => {
    await expect(saml.start({ state: 's', redirectUri: '', domain: null })).rejects.toThrow(
      'Enter your school email',
    );
    await expect(started(samlDomain({ samlCertificate: null }))).rejects.toThrow('not set up');
  });

  test('a signed response to our request is accepted and vouches for its domain', async () => {
    const { secrets } = await started();
    const id = await complete(secrets, response(secrets.requestId));
    expect(id).toMatchObject({
      provider: 'saml',
      subject: 'dom-saml:kai@srmss.edu.gd',
      email: 'kai@srmss.edu.gd',
      verifiedFor: 'srmss.edu.gd',
      profile: { firstName: 'Kai', lastName: 'Joseph' },
    });
    expect(saml.vouchesForDomain(id, ctx('srmss.edu.gd'))).toBe(true);
    expect(saml.vouchesForDomain(id, ctx('smss.edu.gd'))).toBe(false);
  });

  test('an address off the configured domain is signed in but not vouched for', async () => {
    const { secrets } = await started();
    const id = await complete(
      secrets,
      response(secrets.requestId, { nameId: 'kai@other-school.edu' }),
    );
    expect(saml.vouchesForDomain(id, ctx('other-school.edu'))).toBe(false);
  });

  test('a transient NameID falls back to the address as the subject', async () => {
    const { secrets } = await started();
    const id = await complete(
      secrets,
      response(secrets.requestId, {
        nameId: '_abc123',
        nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
        attributes: { mail: 'kai@srmss.edu.gd' },
      }),
    );
    expect(id.subject).toBe('dom-saml:kai@srmss.edu.gd');
  });

  test('signed by another certificate, unsigned, or tampered: rejected', async () => {
    const { secrets } = await started();
    await expect(
      complete(secrets, response(secrets.requestId, { signer: OTHER_IDP })),
    ).rejects.toThrow();
    await expect(
      complete(secrets, response(secrets.requestId, { signer: null })),
    ).rejects.toThrow();
    const tampered = Buffer.from(
      Buffer.from(response(secrets.requestId), 'base64')
        .toString()
        .replace('kai@srmss.edu.gd', 'boss@srmss.edu.gd'),
    ).toString('base64');
    await expect(complete(secrets, tampered)).rejects.toThrow();
  });

  test('wrong issuer, audience, request id, or expired: rejected', async () => {
    const { secrets } = await started();
    await expect(
      complete(secrets, response(secrets.requestId, { issuer: 'https://evil.test' })),
    ).rejects.toThrow();
    await expect(
      complete(secrets, response(secrets.requestId, { audience: 'https://someone-else' })),
    ).rejects.toThrow();
    await expect(complete(secrets, response('_not-our-request'))).rejects.toThrow();
    await expect(
      complete(secrets, response(secrets.requestId, { inResponseTo: undefined })),
    ).rejects.toThrow();
    await expect(
      complete(
        secrets,
        response(secrets.requestId, { now: new Date(Date.now() - 10 * 60_000) }),
      ),
    ).rejects.toThrow();
  });

  test('clock skew up to a minute is tolerated', async () => {
    const { secrets } = await started();
    const id = await complete(
      secrets,
      response(secrets.requestId, { now: new Date(Date.now() + 30_000) }),
    );
    expect(id.email).toBe('kai@srmss.edu.gd');
  });

  test('a domain whose connection changed mid sign-in is refused', async () => {
    const { secrets } = await started();
    await expect(
      complete(secrets, response(secrets.requestId), samlDomain({ id: 'dom-other' })),
    ).rejects.toThrow('changed');
  });

  test('metadata names our entity ID and ACS', () => {
    const xml = saml.metadata();
    expect(xml).toContain(`entityID="https://api.gb.test/api/auth/sso/saml/metadata"`);
    expect(xml).toContain('https://api.gb.test/api/auth/sso/saml/acs');
    expect(xml).toContain('WantAssertionsSigned="true"');
  });

  test('certificates: PEM or bare base64, X.509 only', () => {
    const pem = normalizeCertificate(TEST_IDP.cert)!;
    expect(pem).toContain('-----BEGIN CERTIFICATE-----');
    const bare = TEST_IDP.cert.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    expect(normalizeCertificate(bare)).toBe(pem);
    expect(normalizeCertificate('not a cert')).toBeNull();
    expect(normalizeCertificate(TEST_IDP.key)).toBeNull();
  });
});

describe('standardProfile', () => {
  test('prefers given/family names, falls back to splitting the full name', () => {
    expect(standardProfile({ given_name: 'Kai', family_name: 'Joseph' })).toMatchObject({
      firstName: 'Kai',
      lastName: 'Joseph',
    });
    expect(standardProfile({ name: 'Tia Marie Charles' })).toMatchObject({
      firstName: 'Tia',
      lastName: 'Marie Charles',
    });
  });
});

describe('safeNext', () => {
  test('keeps same-site paths only', () => {
    expect(safeNext('/portal/courses?x=1')).toBe('/portal/courses?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/login', ' /portal', 42]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});

// ── the service ───────────────────────────────────────────────────────────

const studentDomain = {
  id: 'dom-1',
  schoolId: 'school-1',
  domain: 'srmss.edu.gd',
  audience: 'student',
  autoJoin: true,
  ssoProvider: 'google',
  ssoRequired: true,
  azureTenantId: null,
  samlEntryPoint: null,
  samlIssuer: null,
  samlCertificate: null,
};

function build(opts: {
  domain?: any;
  profile?: any;
  registry?: any;
  user?: { id: string; email: string };
} = {}) {
  const inserted: any[] = [];
  const joined: string[] = [];
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue(opts.profile ?? null);
  prisma.user_profile.create.mockImplementation(async ({ data }: any) => {
    inserted.push(data);
    return data;
  });
  const domains = {
    verifiedDomainFor: async () => opts.domain ?? null,
    verifiedDomainById: async (id: string) => (opts.domain?.id === id ? opts.domain : null),
    tryAutoJoin: async (id: string) => {
      joined.push(id);
      return { status: 'joined' };
    },
  };
  const user = opts.user ?? { id: 'user-1', email: 'kai@srmss.edu.gd' };
  const accounts = {
    userForIdentity: mock(async () => user),
  };
  const sessions = {
    create: mock(async (reply: any) => {
      reply.cookies.gb_session = 'token';
      return 'token';
    }),
  };
  const cache = createMockCacheService();
  const service = new SsoService(
    cache as any,
    opts.registry ?? new SsoRegistry(),
    domains as any,
    prisma as any,
    accounts as any,
    sessions as any,
  );
  return { service, inserted, joined, accounts, sessions, cache, prisma };
}

function http(url = '/api/auth/sso/callback', cookies: Record<string, string> = {}) {
  const reply = {
    cookies: {} as Record<string, string>,
    setCookie: mock((name: string, value: string) => {
      reply.cookies[name] = value;
    }),
    clearCookie: mock(() => {}),
  };
  const req = { url, cookies, headers: { host: 'api.gb.test' }, protocol: 'https' };
  return { req: req as any, reply: reply as any };
}

const workspaceStudent = identity(
  'google',
  'kai@srmss.edu.gd',
  { email_verified: true, hd: 'srmss.edu.gd' },
  { profile: { firstName: 'Kai', lastName: 'Joseph', avatarUrl: null } },
);

describe('SsoService.signIn', () => {
  test('a vouched student needs no form: profile made, school joined', async () => {
    const { service, inserted, joined, accounts } = build({ domain: studentDomain });
    const { destination } = await service.signIn(workspaceStudent, new GoogleAdapter(), '/portal/grades');
    expect((accounts.userForIdentity.mock.calls[0] as any[])[1]).toBe(true);
    expect(inserted[0]).toMatchObject({ first_name: 'Kai', last_name: 'Joseph', account_type: 'student' });
    expect(joined).toEqual(['user-1']);
    expect(destination).toBe('/portal/grades');
  });

  test('a shared domain asks student-or-staff first, and joins nobody yet', async () => {
    const { service, inserted, joined } = build({ domain: { ...studentDomain, audience: 'any' } });
    const { destination } = await service.signIn(workspaceStudent, new GoogleAdapter(), null);
    expect(inserted[0].first_name).toBeUndefined();
    expect(joined).toEqual([]);
    expect(destination).toBe('/onboard');
  });

  test('an existing onboarded profile is not re-created', async () => {
    const { service, inserted, joined } = build({
      domain: studentDomain,
      profile: { id: 'user-1', first_name: 'Kai', school_id: null, account_type: 'student' },
    });
    const { destination } = await service.signIn(workspaceStudent, new GoogleAdapter(), null);
    expect(inserted).toEqual([]);
    expect(joined).toEqual(['user-1']);
    expect(destination).toBe('/');
  });

  test('an unvouched sign-in gets an account but no school, and no email trust', async () => {
    const personal = identity('google', 'kai@srmss.edu.gd', { email_verified: true });
    const { service, joined, accounts } = build({ domain: studentDomain });
    const { destination } = await service.signIn(personal, new GoogleAdapter(), null);
    expect((accounts.userForIdentity.mock.calls[0] as any[])[1]).toBe(false);
    expect(joined).toEqual([]);
    expect(destination).toBe('/onboard');
  });

  test('an identity linked to an account with another address joins nothing', async () => {
    const { service, joined } = build({
      domain: studentDomain,
      user: { id: 'user-1', email: 'old@elsewhere.org' },
      profile: { id: 'user-1', first_name: 'Kai', school_id: null, account_type: 'student' },
    });
    await service.signIn(workspaceStudent, new GoogleAdapter(), null);
    expect(joined).toEqual([]);
  });

  test('the wrong provider for a school that requires its own is refused before any account', async () => {
    const { service, accounts } = build({ domain: studentDomain });
    const viaMicrosoft = identity('azure', 'kai@srmss.edu.gd', { tid: TENANT });
    await expect(service.signIn(viaMicrosoft, new AzureAdapter(), null)).rejects.toThrow(
      'Your school signs in with Google',
    );
    expect(accounts.userForIdentity).not.toHaveBeenCalled();
  });
});

describe('SsoService flow', () => {
  /** An adapter that signs in whoever the test says, without a network. */
  function fakeAdapter(result: SsoIdentity | Error = workspaceStudent): SsoAdapter {
    const google = new GoogleAdapter();
    return Object.assign(Object.create(google), {
      start: async (c: any) => ({ url: `https://idp.test/auth?state=${c.state}`, secrets: { v: 'x' } }),
      complete: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    });
  }
  const registryOf = (adapter: SsoAdapter) => ({
    get: (id: string) => (id === adapter.id ? adapter : undefined),
    enabled: () => [],
  });

  const VERIFIER = 'v'.repeat(20) + '-._~' + 'A1b2C3d4E5f6G7h8I9j0K';
  const challengeOf = (verifier: string) =>
    createHash('sha256').update(verifier).digest('base64url');

  async function begin(service: SsoService, platform: 'web' | 'mobile' = 'web', next?: string) {
    const { req, reply } = http('/api/auth/sso/google/start');
    const url = await service.start(req, reply, 'google', {
      platform,
      next,
      ...(platform === 'mobile' ? { code_challenge: challengeOf(VERIFIER) } : {}),
    });
    const state = new URL(url).searchParams.get('state')!;
    return { state, flow: reply.cookies[FLOW_COOKIE] };
  }

  test('web: state is single use and the session cookie is set', async () => {
    const { service, sessions, cache } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    const { state, flow } = await begin(service, 'web', '/portal');
    expect(await cache.get(`sso-state:${state}`)).toMatchObject({ provider: 'google', next: '/portal' });

    const { req, reply } = http(`/api/auth/sso/callback?code=c&state=${state}`, { [FLOW_COOKIE]: flow });
    const to = await service.callback(req, reply, { code: 'c', state });
    expect(to).toEndWith('/portal');
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(reply.cookies.gb_session).toBe('token');

    // Replaying the same callback finds nothing.
    const again = http(`/api/auth/sso/callback?code=c&state=${state}`, { [FLOW_COOKIE]: flow });
    expect(await service.callback(again.req, again.reply, { code: 'c', state })).toContain(
      '/login?error=expired',
    );
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  test('a callback in a browser that did not start the sign-in is refused', async () => {
    const { service, sessions } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    const { state } = await begin(service);
    const { req, reply } = http(`/api/auth/sso/callback?state=${state}`, { [FLOW_COOKIE]: 'someone-elses' });
    expect(await service.callback(req, reply, { code: 'c', state })).toContain('error=expired');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  test('a rejected response or provider error goes back to login', async () => {
    const { service } = build({ registry: registryOf(fakeAdapter(new Error('bad token'))) });
    const { state, flow } = await begin(service);
    const { req, reply } = http('/cb', { [FLOW_COOKIE]: flow });
    expect(await service.callback(req, reply, { code: 'c', state })).toContain('/login?error=expired');

    const second = await begin(service, 'mobile');
    const cancelled = http('/cb', { [FLOW_COOKIE]: second.flow });
    expect(
      await service.callback(cancelled.req, cancelled.reply, { error: 'access_denied', state: second.state }),
    ).toBe('gradebook://sso?error=cancelled');
  });

  test('mobile: no browser session, a one-time handoff code instead', async () => {
    const { service, sessions } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    const { state, flow } = await begin(service, 'mobile');
    const { req, reply } = http('/cb', { [FLOW_COOKIE]: flow });
    const to = await service.callback(req, reply, { code: 'c', state });
    expect(to).toMatch(/^gradebook:\/\/sso\?code=/);
    expect(sessions.create).not.toHaveBeenCalled();

    const code = new URL(to.replace('gradebook://sso', 'https://x')).searchParams.get('code')!;
    const app = http('/api/auth/sso/handoff');
    await service.handoff(app.req, app.reply, code, VERIFIER);
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect((sessions.create.mock.calls[0] as any[])[2]).toBe('user-1');
    // Single use.
    await expect(service.handoff(app.req, app.reply, code, VERIFIER)).rejects.toThrow('expired');
  });

  test('mobile: a build without a code_challenge is sent home to update', async () => {
    const { service } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    const { req, reply } = http('/api/auth/sso/google/start');
    const url = await service.start(req, reply, 'google', { platform: 'mobile' });
    expect(url).toBe(`gradebook://sso?error=${encodeURIComponent(OUTDATED_APP_MESSAGE)}`);
    expect(new URL(url.replace('gradebook://sso', 'https://x')).searchParams.get('error')).toBe(
      'This version of GradeBook is out of date. Update the app from the App Store or Google Play to sign in.',
    );
    // Nothing started: no flow cookie.
    expect(reply.cookies[FLOW_COOKIE]).toBeUndefined();
  });

  test('mobile: start needs a well-formed code_challenge', async () => {
    const { service, cache } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    for (const code_challenge of ['', 'short', challengeOf(VERIFIER) + 'x', 'a'.repeat(42) + '=']) {
      const { req, reply } = http('/api/auth/sso/google/start');
      await expect(
        service.start(req, reply, 'google', { platform: 'mobile', code_challenge }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(reply.cookies[FLOW_COOKIE]).toBeUndefined();
    }
    // Web ignores it, and does not store one.
    const { state } = await begin(service, 'web');
    expect((await cache.get(`sso-state:${state}`)).codeChallenge).toBeUndefined();
  });

  test('mobile: a handoff code is useless without the starting app\'s verifier', async () => {
    const { service, sessions } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    const finish = async () => {
      const { state, flow } = await begin(service, 'mobile');
      const { req, reply } = http('/cb', { [FLOW_COOKIE]: flow });
      const to = await service.callback(req, reply, { code: 'c', state });
      return new URL(to.replace('gradebook://sso', 'https://x')).searchParams.get('code')!;
    };
    const app = http('/api/auth/sso/handoff');

    // Another app (or an attacker's link) has the code but not the verifier.
    const stolen = await finish();
    await expect(
      service.handoff(app.req, app.reply, stolen, 'w'.repeat(43)),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The miss burned the code: the real verifier no longer works either.
    await expect(service.handoff(app.req, app.reply, stolen, VERIFIER)).rejects.toThrow('expired');

    // Missing or malformed verifiers are refused (and burn the code too).
    for (const bad of [undefined, '', 'short', VERIFIER + '!']) {
      const code = await finish();
      await expect(service.handoff(app.req, app.reply, code, bad as any)).rejects.toThrow('expired');
      await expect(service.handoff(app.req, app.reply, code, VERIFIER)).rejects.toThrow('expired');
    }
    expect(sessions.create).not.toHaveBeenCalled();
  });

  test('mobile: a handoff minted without a challenge is never redeemed', async () => {
    const { service, sessions, cache } = build({ domain: studentDomain, registry: registryOf(fakeAdapter()) });
    await cache.set('sso-handoff:legacy', { userId: 'user-1', provider: 'google' }, 120);
    const app = http('/api/auth/sso/handoff');
    await expect(service.handoff(app.req, app.reply, 'legacy', VERIFIER)).rejects.toThrow('expired');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  test('SAML: ACS checks the assertion, the callback signs in', async () => {
    const domain = {
      ...studentDomain,
      id: 'dom-saml',
      ssoProvider: 'saml',
      samlEntryPoint: 'https://idp.srmss.edu.gd/sso',
      samlIssuer: IDP_ISSUER,
      samlCertificate: TEST_IDP.cert,
    };
    const { service, sessions, cache, accounts } = build({ domain });
    const { req, reply } = http('/api/auth/sso/saml/start');
    const url = await service.start(req, reply, 'saml', { email: 'kai@srmss.edu.gd' });
    const state = new URL(url).searchParams.get('RelayState')!;
    const pending = await cache.get(`sso-state:${state}`);
    const SAMLResponse = buildSamlResponse({
      issuer: IDP_ISSUER,
      audience: samlEntityId(),
      acsUrl: samlAcsUrl(),
      inResponseTo: pending.secrets.requestId,
      nameId: 'kai@srmss.edu.gd',
      attributes: { givenName: 'Kai', sn: 'Joseph' },
    });

    const next = await service.samlAcs({ SAMLResponse, RelayState: state });
    expect(next).toBe(`https://api.gb.test/api/auth/sso/callback?state=${state}`);
    // The same assertion again is refused.
    expect(await service.samlAcs({ SAMLResponse, RelayState: state })).toContain('error=expired');

    const cb = http(`/api/auth/sso/callback?state=${state}`, { [FLOW_COOKIE]: reply.cookies[FLOW_COOKIE] });
    const to = await service.callback(cb.req, cb.reply, { state });
    expect(to).toEndWith('/');
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect((accounts.userForIdentity.mock.calls[0] as any[])[1]).toBe(true);
  });

  test('SAML: a forged assertion never reaches the callback', async () => {
    const domain = {
      ...studentDomain,
      id: 'dom-saml',
      ssoProvider: 'saml',
      samlEntryPoint: 'https://idp.srmss.edu.gd/sso',
      samlIssuer: IDP_ISSUER,
      samlCertificate: TEST_IDP.cert,
    };
    const { service, cache } = build({ domain });
    const { req, reply } = http('/x');
    const url = await service.start(req, reply, 'saml', { email: 'kai@srmss.edu.gd' });
    const state = new URL(url).searchParams.get('RelayState')!;
    const pending = await cache.get(`sso-state:${state}`);
    const forged = buildSamlResponse({
      issuer: IDP_ISSUER,
      audience: samlEntityId(),
      acsUrl: samlAcsUrl(),
      inResponseTo: pending.secrets.requestId,
      nameId: 'kai@srmss.edu.gd',
      signer: OTHER_IDP,
    });
    expect(await service.samlAcs({ SAMLResponse: forged, RelayState: state })).toContain(
      '/login?error=failed',
    );
    expect(await cache.get(`sso-state:${state}`)).toBeNull();
  });

  test('discover offers a provider only once the school finished setting it up', async () => {
    const half = { ...studentDomain, ssoProvider: 'saml', ssoRequired: true };
    expect(await build({ domain: half }).service.discover('kai@srmss.edu.gd')).toEqual({
      provider: null,
      required: false,
    });
    const done = { ...half, samlEntryPoint: 'https://idp/sso', samlIssuer: 'x', samlCertificate: TEST_IDP.cert };
    expect(await build({ domain: done }).service.discover('kai@srmss.edu.gd')).toMatchObject({
      provider: { id: 'saml' },
      required: true,
    });
  });

  test('suggested profile comes from the last identity used', async () => {
    const { service, prisma } = build();
    prisma.identity.findFirst.mockResolvedValue({
      provider: 'google',
      claims: { given_name: 'Kai', family_name: 'Joseph' },
    });
    expect(await service.suggestedProfile('user-1')).toMatchObject({ firstName: 'Kai', lastName: 'Joseph' });
    prisma.identity.findFirst.mockResolvedValue(null);
    expect(await service.suggestedProfile('user-1')).toBeNull();
  });
});

beforeEach(() => {
  process.env.SSO_PROVIDERS = 'google,azure,saml';
});
