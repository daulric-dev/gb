import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { STAFF_ROLES, type CourseRole } from '@/course/access/course-access.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { csrfViolation, formBodyParser } from '@/common/csrf';
import { PlatformKeyService } from './platform-key.service';
import { ToolKeyService } from './tool-key.service';
import { LtiLaunchService, ltiRoles } from './lti-launch.service';
import { LtiRateLimiter, LtiTokenService, OAuthError } from './lti-token.service';
import { LtiAgsService, parseScore } from './lti-ags.service';
import { LtiOrganisationFeatureGuard } from './lti.controllers';
import { checkClaims, decodeJwt, rsaKeyFromJwk, signJwt, verifySignature, JwtError } from './jwt';
import { scaleScore, sha256 } from './lti-values';
import { CLAIM, CLIENT_ASSERTION_TYPE, ROLE, SCOPE, platformEndpoints } from './lti.constants';

process.env.API_URL = 'https://api.example.com';

const TOOL_ID = randomUUID();
const OTHER_TOOL_ID = randomUUID();
const COURSE_ID = randomUUID();
const SCHOOL_ID = randomUUID();
const ITEM_ID = randomUUID();
const LINK_ID = randomUUID();
const USER_ID = randomUUID();
const STUDENT_ID = randomUUID();
const TEACHER_ID = randomUUID();
const LINE_ITEM_ID = randomUUID();
const ACTIVITY_ID = randomUUID();
const CLIENT_ID = 'gb-test-client';
const REDIRECT = 'https://tool.example.org/lti/launch';

function uniqueError() {
  return Object.assign(new Error('duplicate key'), { code: '23505' });
}

function features(on = true) {
  return { isEnabled: mock(async () => on), assertEnabled: mock(async () => undefined) } as any;
}

/** Platform keys kept in memory, through the real PlatformKeyService. */
function keyStore(prisma: MockPrisma) {
  const rows: any[] = [];
  prisma.lti_platform_key.findFirst.mockImplementation(async ({ where }: any) =>
    rows.find((r) => (where?.active === undefined ? true : r.active === where.active)) ?? null,
  );
  prisma.lti_platform_key.create.mockImplementation(async ({ data }: any) => {
    if (data.active && rows.some((r) => r.active)) throw uniqueError();
    const row = { ...data, created_at: new Date(), retired_at: null };
    rows.push(row);
    return row;
  });
  prisma.lti_platform_key.updateMany.mockImplementation(async ({ data }: any) => {
    let count = 0;
    for (const r of rows) {
      if (r.active) {
        Object.assign(r, data);
        count++;
      }
    }
    return { count };
  });
  prisma.lti_platform_key.findMany.mockImplementation(async () =>
    rows.filter((r) => r.active || r.retired_at).map((r) => ({ ...r })),
  );
  return rows;
}

function replayStore(prisma: MockPrisma) {
  const seen = new Set<string>();
  prisma.lti_replay.create.mockImplementation(async ({ data }: any) => {
    const key = `${data.tool_id}:${data.kind}:${data.value}`;
    if (seen.has(key)) throw uniqueError();
    seen.add(key);
    return data;
  });
  return seen;
}

// ── JWT helpers ─────────────────────────────────────────────────────────────

describe('jwt', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  test('RS256 round trip, and tampering fails', () => {
    const token = signJwt({ a: 1 }, privateKey, 'k1');
    const decoded = decodeJwt(token);
    expect(decoded.header).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
    expect(verifySignature(decoded, publicKey)).toBe(true);
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ a: 2 })).toString('base64url')}.${s}`;
    expect(verifySignature(decodeJwt(forged), publicKey)).toBe(false);
  });

  test('refuses alg none and HS256', () => {
    const body = Buffer.from('{}').toString('base64url');
    for (const alg of ['none', 'HS256']) {
      const header = Buffer.from(JSON.stringify({ alg })).toString('base64url');
      expect(() => decodeJwt(`${header}.${body}.c2ln`)).toThrow(JwtError);
    }
  });

  test('checkClaims: exp, iat, aud, iss and lifetime', () => {
    const now = 1_800_000_000;
    const ok = { exp: now + 60, iat: now, aud: 'a', iss: 'i' };
    expect(() => checkClaims(ok, { audience: ['a'], issuer: 'i', skewSeconds: 0, nowSeconds: now })).not.toThrow();
    expect(() => checkClaims({ ...ok, exp: now - 10 }, { audience: ['a'], skewSeconds: 0, nowSeconds: now })).toThrow('expired');
    expect(() => checkClaims({ ...ok, iat: now + 600 }, { audience: ['a'], skewSeconds: 60, nowSeconds: now })).toThrow('future');
    expect(() => checkClaims({ ...ok, aud: ['x', 'y'] }, { audience: ['a'], skewSeconds: 0, nowSeconds: now })).toThrow('audience');
    expect(() => checkClaims(ok, { audience: ['a'], issuer: 'other', skewSeconds: 0, nowSeconds: now })).toThrow('issuer');
    expect(() =>
      checkClaims({ ...ok, exp: now + 3600 }, { audience: ['a'], skewSeconds: 0, nowSeconds: now, maxLifetimeSeconds: 600 }),
    ).toThrow('lifetime');
  });

  test('scaleScore scales to the activity points, two decimals, clamped', () => {
    expect(scaleScore(7, 10, 20)).toBe(14);
    expect(scaleScore(1, 3, 10)).toBe(3.33);
    expect(scaleScore(12, 10, 20)).toBe(20);
    expect(scaleScore(0, 10, 20)).toBe(0);
  });
});

// ── roles ───────────────────────────────────────────────────────────────────

describe('role mapping', () => {
  test('course roles map to LIS roles', () => {
    expect(ltiRoles('student')).toEqual([ROLE.learner]);
    expect(ltiRoles('teacher')).toEqual([ROLE.instructor]);
    expect(ltiRoles('ta')).toEqual([ROLE.instructor, ROLE.teachingAssistant]);
    expect(ltiRoles('admin')).toEqual([ROLE.instructor, ROLE.administrator]);
  });
});

// ── launch ──────────────────────────────────────────────────────────────────

function launchWorld(opts: { role?: CourseRole | null; student?: boolean; featureOn?: boolean } = {}) {
  const prisma = createMockPrisma();
  keyStore(prisma);
  replayStore(prisma);
  const launches: any[] = [];
  const tool = {
    id: TOOL_ID,
    client_id: CLIENT_ID,
    enabled: true,
    login_url: 'https://tool.example.org/lti/login',
    target_link_uri: 'https://tool.example.org/lti/launch',
    redirect_uri_entries: [{ redirect_uri: REDIRECT }],
    ags_enabled: true,
    send_name: false,
    send_email: false,
    custom_params: { a: '1' },
  };
  prisma.course.findUnique.mockResolvedValue({
    id: COURSE_ID,
    school_id: SCHOOL_ID,
    academic_year_id: null,
    term_id: null,
    name: 'Biology',
    code: 'BIO1',
    description: null,
    status: 'published',
    join_code: null,
    grade_scale_id: null,
    is_template: false,
    banner_color: null,
    banner_image_path: null,
    created_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  prisma.lti_resource_link.findFirst.mockResolvedValue({
    id: LINK_ID,
    deployment: { deployment_id: 'gbd-1', school_id: null },
    tool,
    module_item: { is_published: true, module: { is_published: true } },
  });
  prisma.student.findFirst.mockResolvedValue(opts.student ? { id: STUDENT_ID } : null);
  prisma.lti_subject.upsert.mockResolvedValue({ id: 'sub-1' });
  prisma.lti_launch.create.mockImplementation(async ({ data }: any) => {
    const row = { id: randomUUID(), used_at: null, ...data };
    launches.push(row);
    return row;
  });
  prisma.lti_launch.findUnique.mockImplementation(async ({ where }: any) => {
    const row = launches.find((l) => l.token_hash === where.token_hash);
    if (!row) return null;
    return {
      ...row,
      resource_link: {
        id: LINK_ID,
        custom_params: { b: '2' },
        deployment: { deployment_id: 'gbd-1' },
        module_item: { title: 'Lab sim' },
        line_items: [{ id: LINE_ITEM_ID }],
        course: { id: COURSE_ID, school_id: SCHOOL_ID, name: 'Biology', code: 'BIO1' },
      },
    };
  });
  prisma.lti_launch.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = launches.find((l) => l.id === where.id && l.used_at === null && l.expires_at > new Date());
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  prisma.lti_tool.findUnique.mockImplementation(async ({ where }: any) =>
    where.client_id === CLIENT_ID ? tool : null,
  );
  prisma.organisation.findFirst.mockResolvedValue({ id: 'org-1', name: 'Org' });

  const access = {
    roleIn: mock(async () => opts.role ?? null),
    requireStudent: mock(async () => ({})),
  } as any;
  const keys = new PlatformKeyService(prisma as any);
  const service = new LtiLaunchService(prisma as any, access, features(opts.featureOn ?? true), keys);
  return { prisma, service, keys, launches, tool, access };
}

function authParams(url: string, over: Record<string, string> = {}) {
  const u = new URL(url);
  return {
    scope: 'openid',
    response_type: 'id_token',
    response_mode: 'form_post',
    prompt: 'none',
    client_id: u.searchParams.get('client_id')!,
    redirect_uri: REDIRECT,
    login_hint: u.searchParams.get('login_hint')!,
    lti_message_hint: u.searchParams.get('lti_message_hint')!,
    nonce: randomUUID(),
    state: 'state-1',
    ...over,
  };
}

function idTokenFrom(html: string): string {
  const m = /name="id_token" value="([^"]+)"/.exec(html);
  if (!m) throw new Error('no id_token in page');
  return m[1];
}

describe('LTI launch', () => {
  test('start returns the tool login URL with a single-use hint bound to the user', async () => {
    const { service, launches } = launchWorld({ role: 'teacher' });
    const { url } = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://tool.example.org/lti/login');
    expect(u.searchParams.get('iss')).toBe('https://api.example.com');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('lti_deployment_id')).toBe('gbd-1');
    expect(u.searchParams.get('login_hint')).toBe('sub-1');
    const hint = u.searchParams.get('lti_message_hint')!;
    expect(launches[0].token_hash).toBe(sha256(hint));
    expect(launches[0].token_hash).not.toBe(hint);
    expect(launches[0].user_profile_id).toBe(USER_ID);
    expect(launches[0].roles).toEqual([ROLE.instructor]);
  });

  test('a student launches as Learner; someone with no part in the course gets 404', async () => {
    const student = launchWorld({ student: true });
    await student.service.start(USER_ID, COURSE_ID, ITEM_ID);
    expect(student.launches[0].roles).toEqual([ROLE.learner]);

    const outsider = launchWorld({});
    expect(await expectRejection(outsider.service.start(USER_ID, COURSE_ID, ITEM_ID))).toBeInstanceOf(NotFoundException);
  });

  test('id_token carries the LTI claims and verifies with the published JWKS', async () => {
    const { service, keys } = launchWorld({ role: 'ta' });
    const { url } = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    const params = authParams(url);
    const page = await service.authorize(params, null);
    expect(page.status).toBe(200);
    expect(page.headers['Content-Security-Policy']).toContain('form-action https://tool.example.org');
    expect(page.body).toContain(`action="${REDIRECT}"`);
    expect(page.body).toContain('name="state" value="state-1"');

    const decoded = decodeJwt(idTokenFrom(page.body));
    const jwks = await keys.jwks();
    const jwk = jwks.keys.find((k) => k.kid === decoded.header.kid)!;
    expect(jwk).toBeDefined();
    expect(jwk).not.toHaveProperty('d');
    expect(verifySignature(decoded, rsaKeyFromJwk(jwk)!)).toBe(true);

    const c = decoded.payload;
    expect(c.iss).toBe('https://api.example.com');
    expect(c.aud).toBe(CLIENT_ID);
    expect(c.sub).toBe('sub-1');
    expect(c.nonce).toBe(params.nonce);
    expect(c[CLAIM.messageType]).toBe('LtiResourceLinkRequest');
    expect(c[CLAIM.version]).toBe('1.3.0');
    expect(c[CLAIM.deploymentId]).toBe('gbd-1');
    expect(c[CLAIM.targetLinkUri]).toBe('https://tool.example.org/lti/launch');
    expect(c[CLAIM.resourceLink]).toEqual({ id: LINK_ID, title: 'Lab sim' });
    expect(c[CLAIM.roles]).toEqual([ROLE.instructor, ROLE.teachingAssistant]);
    expect((c[CLAIM.context] as any).id).toBe(COURSE_ID);
    expect(c[CLAIM.custom]).toEqual({ a: '1', b: '2' });
    expect(c[CLAIM.launchPresentation]).toEqual({ document_target: 'window' });
    const ags = c[CLAIM.agsEndpoint] as any;
    expect(ags.scope).toContain(SCOPE.score);
    expect(ags.lineitems).toBe(`https://api.example.com/api/lti/ags/courses/${COURSE_ID}/lineitems`);
    expect(ags.lineitem).toBe(`${ags.lineitems}/${LINE_ITEM_ID}`);
    // Privacy: no name or email unless the tool is allowed them.
    expect(c.name).toBeUndefined();
    expect(c.email).toBeUndefined();
    expect((c.exp as number) - (c.iat as number)).toBe(300);
  });

  test('name and email are sent only when the tool is allowed them', async () => {
    const world = launchWorld({ role: 'teacher' });
    world.tool.send_name = true;
    world.tool.send_email = true;
    world.prisma.user_profile.findUnique.mockResolvedValue({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      app_user: { email: 'ada@example.org' },
    });
    const { url } = await world.service.start(USER_ID, COURSE_ID, ITEM_ID);
    const page = await world.service.authorize(authParams(url), null);
    const c = decodeJwt(idTokenFrom(page.body)).payload;
    expect(c.name).toBe('Ada Lovelace');
    expect(c.email).toBe('ada@example.org');
  });

  test('the launch hint is single use', async () => {
    const { service } = launchWorld({ role: 'teacher' });
    const { url } = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    expect((await service.authorize(authParams(url), null)).status).toBe(200);
    const again = await service.authorize(authParams(url), null);
    expect(again.status).toBe(400);
    expect(again.body).not.toContain('name="id_token"');
  });

  test('a nonce is single use per tool', async () => {
    const { service } = launchWorld({ role: 'teacher' });
    const first = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    const second = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    expect((await service.authorize(authParams(first.url, { nonce: 'n-1' }), null)).status).toBe(200);
    const replay = await service.authorize(authParams(second.url, { nonce: 'n-1' }), null);
    expect(replay.status).toBe(400);
    expect(replay.body).toContain('nonce');
  });

  test('an expired hint is refused', async () => {
    const { service, launches } = launchWorld({ role: 'teacher' });
    const { url } = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    launches[0].expires_at = new Date(Date.now() - 1000);
    expect((await service.authorize(authParams(url), null)).status).toBe(400);
  });

  test('wrong client, unregistered redirect URI, wrong login_hint and another user are refused', async () => {
    const { service } = launchWorld({ role: 'teacher' });
    const { url } = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    for (const over of <Record<string, string>[]>[
      { client_id: 'someone-else' },
      { redirect_uri: 'https://evil.example.com/collect' },
      { login_hint: 'sub-2' },
      { response_type: 'code' },
      { nonce: '' },
    ]) {
      const page = await service.authorize(authParams(url, over), null);
      expect(page.status).toBe(400);
      expect(page.body).not.toContain('name="id_token"');
    }
    const other = await service.authorize(authParams(url), randomUUID());
    expect(other.status).toBe(400);
    // None of the refusals spent the ticket.
    expect((await service.authorize(authParams(url), USER_ID)).status).toBe(200);
  });

  test('a hint issued for another tool is refused', async () => {
    const world = launchWorld({ role: 'teacher' });
    const { url } = await world.service.start(USER_ID, COURSE_ID, ITEM_ID);
    world.launches[0].tool_id = OTHER_TOOL_ID;
    expect((await world.service.authorize(authParams(url), null)).status).toBe(400);
  });

  test('with lti off for the school the launch is refused', async () => {
    const { service } = launchWorld({ role: 'teacher', featureOn: false });
    const { url } = await service.start(USER_ID, COURSE_ID, ITEM_ID);
    const page = await service.authorize(authParams(url), null);
    expect(page.status).toBe(400);
    expect(page.body).toContain('turned off');
  });

  test('error pages escape what they echo and carry no script', async () => {
    const { service } = launchWorld({ role: 'teacher' });
    const page = await service.authorize({ client_id: '<x>', redirect_uri: 'r' }, null);
    expect(page.status).toBe(400);
    expect(page.body).not.toContain('<script');
    expect(page.headers['Content-Security-Policy']).toContain("default-src 'none'");
  });
});

// ── platform keys ───────────────────────────────────────────────────────────

describe('platform keys', () => {
  test('one key is created on first use; rotation keeps the old one published', async () => {
    const prisma = createMockPrisma();
    const rows = keyStore(prisma);
    const keys = new PlatformKeyService(prisma as any);
    const first = await keys.activeKey();
    expect(rows).toHaveLength(1);
    expect(rows[0].private_key_sealed).not.toContain('PRIVATE KEY');
    const { kid, retired } = await keys.rotate();
    expect(retired).toBe(first.kid);
    const published = (await keys.jwks()).keys.map((k) => k.kid);
    expect(published).toContain(kid);
    expect(published).toContain(first.kid);
    const token = await keys.sign({ x: 1 });
    expect(decodeJwt(token).header.kid).toBe(kid);
  });

  test('the private key decrypts from its sealed form in a fresh instance', async () => {
    const prisma = createMockPrisma();
    keyStore(prisma);
    await new PlatformKeyService(prisma as any).activeKey();
    const fresh = new PlatformKeyService(prisma as any);
    const token = await fresh.sign({ y: 2 });
    const decoded = decodeJwt(token);
    const jwk = (await fresh.jwks()).keys.find((k) => k.kid === decoded.header.kid)!;
    expect(verifySignature(decoded, rsaKeyFromJwk(jwk)!)).toBe(true);
  });
});

// ── AGS token endpoint ──────────────────────────────────────────────────────

function toolKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicKey, privateKey, pem: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
}

function tokenWorld(opts: { featureOn?: boolean; ags?: boolean } = {}) {
  const prisma = createMockPrisma();
  replayStore(prisma);
  const pair = toolKeyPair();
  const tool = {
    id: TOOL_ID,
    enabled: true,
    ags_enabled: opts.ags ?? true,
    jwks_url: null,
    public_key_pem: pair.pem,
  };
  prisma.lti_tool.findUnique.mockImplementation(async ({ where }: any) => (where.client_id === CLIENT_ID ? tool : null));
  const tokens: any[] = [];
  prisma.lti_access_token.create.mockImplementation(async ({ data }: any) => {
    tokens.push(data);
    return data;
  });
  prisma.lti_access_token.findUnique.mockImplementation(async ({ where }: any) => {
    const row = tokens.find((t) => t.token_hash === where.token_hash);
    return row ? { ...row, tool: { enabled: tool.enabled, ags_enabled: tool.ags_enabled } } : null;
  });
  const limiter = new LtiRateLimiter(createMockCacheService() as any);
  const service = new LtiTokenService(prisma as any, features(opts.featureOn ?? true), new ToolKeyService(), limiter);
  return { prisma, service, pair, tool, tokens };
}

function assertion(privateKey: KeyObject, over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: CLIENT_ID,
      sub: CLIENT_ID,
      aud: platformEndpoints().tokenUrl,
      iat: now,
      exp: now + 300,
      jti: randomUUID(),
      ...over,
    },
    privateKey,
    'tool-kid',
  );
}

function tokenBody(clientAssertion: string, scope = `${SCOPE.score} ${SCOPE.lineItem}`) {
  return {
    grant_type: 'client_credentials',
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: clientAssertion,
    scope,
  };
}

describe('AGS token endpoint (client credentials with a signed client assertion)', () => {
  test('a valid assertion gets a short-lived token for the AGS scopes asked for', async () => {
    const { service, pair, tokens } = tokenWorld();
    const res = await service.issue(tokenBody(assertion(pair.privateKey), `${SCOPE.score} openid ${SCOPE.lineItem}`));
    expect(res.token_type).toBe('Bearer');
    expect(res.expires_in).toBe(900);
    expect(res.scope.split(' ').sort()).toEqual([SCOPE.lineItem, SCOPE.score].sort());
    expect(tokens[0].token_hash).toBe(sha256(res.access_token));
    const caller = await service.resolve(`Bearer ${res.access_token}`);
    expect(caller).toEqual({ toolId: TOOL_ID, scopes: tokens[0].scopes });
    expect(await service.resolve('Bearer nope-nope-nope-nope-nope')).toBeNull();
  });

  test('a replayed assertion (same jti) is refused', async () => {
    const { service, pair } = tokenWorld();
    const a = assertion(pair.privateKey);
    await service.issue(tokenBody(a));
    const err = (await expectRejection(service.issue(tokenBody(a)))) as OAuthError;
    expect(err.status).toBe(401);
    expect(err.error).toBe('invalid_client');
  });

  test('wrong key, wrong audience, expired, unknown client and missing jti are refused', async () => {
    const { service, pair } = tokenWorld();
    const stranger = toolKeyPair();
    const cases = [
      assertion(stranger.privateKey),
      assertion(pair.privateKey, { aud: 'https://elsewhere.example.com/token' }),
      assertion(pair.privateKey, { exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900 }),
      assertion(pair.privateKey, { iss: 'other', sub: 'other' }),
      assertion(pair.privateKey, { sub: 'someone-else' }),
      assertion(pair.privateKey, { jti: undefined }),
      assertion(pair.privateKey, { exp: Math.floor(Date.now() / 1000) + 3600 }),
    ];
    for (const a of cases) {
      const err = (await expectRejection(service.issue(tokenBody(a)))) as OAuthError;
      expect(err).toBeInstanceOf(OAuthError);
      expect(err.status).toBe(401);
    }
  });

  test('bad grant type and no AGS scope are 400', async () => {
    const { service, pair } = tokenWorld();
    const grant = (await expectRejection(
      service.issue({ ...tokenBody(assertion(pair.privateKey)), grant_type: 'password' }),
    )) as OAuthError;
    expect(grant.error).toBe('unsupported_grant_type');
    const scope = (await expectRejection(service.issue(tokenBody(assertion(pair.privateKey), 'openid')))) as OAuthError;
    expect(scope.error).toBe('invalid_scope');
  });

  test('with lti off for the organisation the token endpoint answers 403', async () => {
    const { service, pair } = tokenWorld({ featureOn: false });
    const err = (await expectRejection(service.issue(tokenBody(assertion(pair.privateKey))))) as OAuthError;
    expect(err.status).toBe(403);
  });

  test('a tool without grade services gets no token', async () => {
    const { service, pair } = tokenWorld({ ags: false });
    const err = (await expectRejection(service.issue(tokenBody(assertion(pair.privateKey))))) as OAuthError;
    expect(err.error).toBe('unauthorized_client');
  });

  test('the per-tool rate limit applies', async () => {
    const prev = process.env.LTI_TOOL_RATE_LIMIT;
    process.env.LTI_TOOL_RATE_LIMIT = '2';
    try {
      const { service, pair } = tokenWorld();
      await service.issue(tokenBody(assertion(pair.privateKey)));
      await service.issue(tokenBody(assertion(pair.privateKey)));
      const err = (await expectRejection(service.issue(tokenBody(assertion(pair.privateKey))))) as OAuthError;
      expect(err.status).toBe(429);
    } finally {
      if (prev === undefined) delete process.env.LTI_TOOL_RATE_LIMIT;
      else process.env.LTI_TOOL_RATE_LIMIT = prev;
    }
  });
});

// ── tool JWKS fetch ─────────────────────────────────────────────────────────

describe('tool JWKS', () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });

  test('the SSRF guard refuses private and loopback JWKS hosts', async () => {
    const keys = new ToolKeyService();
    for (const url of ['http://127.0.0.1/jwks', 'http://10.1.2.3/jwks', 'http://169.254.169.254/latest', 'http://[::1]/jwks']) {
      const err = (await expectRejection(
        keys.keyFor({ id: randomUUID(), jwks_url: url, public_key_pem: null }, 'k'),
      )) as Error;
      expect(err.message).toMatch(/private|reserved|Could not fetch/);
    }
  });

  test('keys are picked by kid from the fetched set, and a redirect is not followed', async () => {
    const pair = toolKeyPair();
    const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as object), kid: 'k1', use: 'sig', alg: 'RS256' };
    const keys = new ToolKeyService();
    const calls: any[] = [];
    keys.fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    };
    const tool = { id: randomUUID(), jwks_url: 'https://tool.example.org/jwks', public_key_pem: null };
    const key = await keys.keyFor(tool, 'k1');
    expect(key.export({ format: 'jwk' })).toMatchObject({ n: (jwk as any).n });
    expect(calls[0].init.redirect).toBe('manual');
    expect(await expectRejection(keys.keyFor(tool, 'unknown'))).toBeInstanceOf(Error);

    keys.fetchImpl = async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } });
    const err = (await expectRejection(
      keys.keyFor({ id: randomUUID(), jwks_url: 'https://tool.example.org/jwks', public_key_pem: null }, 'k1'),
    )) as Error;
    expect(err.message).toContain('302');
  });

  test('small RSA keys and non-RSA keys are ignored', () => {
    const malformedRsa = { kty: 'RSA', e: 'AQAB' };
    expect(rsaKeyFromJwk(malformedRsa as any)).toBeNull();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
    expect(rsaKeyFromJwk(ec as any)).toBeNull();
    expect(createPublicKey).toBeDefined();
  });
});

// ── AGS scores ──────────────────────────────────────────────────────────────

function agsWorld(opts: { featureOn?: boolean; points?: number; deployed?: boolean } = {}) {
  const prisma = createMockPrisma();
  prisma.course.findUnique.mockResolvedValue({ id: COURSE_ID, school_id: SCHOOL_ID, is_template: false });
  prisma.lti_deployment.count.mockResolvedValue(opts.deployed === false ? 0 : 1);
  prisma.lti_line_item.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === LINE_ITEM_ID && where.tool_id === TOOL_ID && where.course_id === COURSE_ID
      ? {
          id: LINE_ITEM_ID,
          tool_id: TOOL_ID,
          course_id: COURSE_ID,
          activity_id: ACTIVITY_ID,
          resource_link_id: LINK_ID,
          tag: null,
          resource_id: null,
          activity: { id: ACTIVITY_ID, title: 'Lab', points: opts.points ?? 20, due_at: null, status: 'published' },
          resource_link: { created_by: TEACHER_ID },
        }
      : null,
  );
  prisma.lti_subject.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === 'sub-1' && where.tool_id === TOOL_ID ? { id: 'sub-1', user_profile_id: USER_ID } : null,
  );
  prisma.student.findFirst.mockResolvedValue({ id: STUDENT_ID });
  prisma.course_student.findFirst.mockResolvedValue({ student_id: STUDENT_ID });
  prisma.course_staff.findMany.mockResolvedValue([{ user_profile_id: TEACHER_ID }]);
  let last: Date | null = null;
  prisma.lti_score.findUnique.mockImplementation(async () => (last ? { timestamp: last } : null));
  prisma.lti_score.upsert.mockImplementation(async ({ create }: any) => {
    last = create.timestamp;
    return create;
  });
  const access = {
    require: mock(async (userId: string, _c: string, allowed: readonly CourseRole[] = STAFF_ROLES) => {
      if (userId !== TEACHER_ID) throw new NotFoundException('Course not found');
      if (!allowed.includes('teacher')) throw new ForbiddenException('no');
      return { course: { id: COURSE_ID, school_id: SCHOOL_ID }, role: 'teacher' };
    }),
  } as any;
  const submissions = { grade: mock(async () => ({})) } as any;
  const auditLog = { record: mock(async () => undefined) } as any;
  const service = new LtiAgsService(
    prisma as any,
    features(opts.featureOn ?? true),
    access,
    {} as any,
    submissions,
    auditLog,
  );
  const caller = { toolId: TOOL_ID, scopes: [SCOPE.score, SCOPE.lineItem, SCOPE.resultReadonly] };
  return { prisma, service, submissions, auditLog, caller };
}

function score(over: Record<string, unknown> = {}) {
  return {
    userId: 'sub-1',
    scoreGiven: 7,
    scoreMaximum: 10,
    comment: 'Well done',
    timestamp: new Date().toISOString(),
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    ...over,
  };
}

describe('AGS scores', () => {
  test('a FullyGraded score is scaled to the activity points and written through the grading service', async () => {
    const { service, submissions, auditLog, caller } = agsWorld({ points: 20 });
    const res = await service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score());
    expect(res).toEqual({ written: true, score: 14 });
    expect(submissions.grade).toHaveBeenCalledWith(TEACHER_ID, ACTIVITY_ID, STUDENT_ID, { score: 14, feedback: 'Well done' });
    expect(auditLog.record.mock.calls[0][3].entity).toBe('lti_score');
  });

  test('only FullyGraded writes a mark', async () => {
    for (const gradingProgress of ['Pending', 'PendingManual', 'Failed', 'NotReady']) {
      const { service, submissions, caller } = agsWorld();
      const res = await service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score({ gradingProgress }));
      expect(res.written).toBe(false);
      expect(submissions.grade).not.toHaveBeenCalled();
    }
    const { service, submissions, caller } = agsWorld();
    await service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score({ scoreGiven: undefined, scoreMaximum: undefined }));
    expect(submissions.grade).not.toHaveBeenCalled();
  });

  test('a score older than the last one is refused', async () => {
    const { service, caller } = agsWorld();
    const now = Date.now();
    await service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score({ timestamp: new Date(now).toISOString() }));
    const err = await expectRejection(
      service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score({ timestamp: new Date(now - 1000).toISOString() })),
    );
    expect(err).toBeInstanceOf(ConflictException);
  });

  test("another tool's line item, an unknown user and a missing scope are refused", async () => {
    const { service, caller } = agsWorld();
    expect(
      await expectRejection(service.postScore({ ...caller, toolId: OTHER_TOOL_ID }, COURSE_ID, LINE_ITEM_ID, score())),
    ).toBeInstanceOf(NotFoundException);
    const unknown = (await expectRejection(service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score({ userId: 'sub-x' })))) as Error;
    expect(unknown.message).toContain('Unknown userId');
    expect(
      await expectRejection(service.postScore({ ...caller, scopes: [SCOPE.lineItemReadonly] }, COURSE_ID, LINE_ITEM_ID, score())),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a course in a school the tool is not deployed to is not found', async () => {
    const { service, caller } = agsWorld({ deployed: false });
    expect(await expectRejection(service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score()))).toBeInstanceOf(
      NotFoundException,
    );
  });

  test('with lti off for the school AGS answers 403 FEATURE_DISABLED', async () => {
    const { service, caller } = agsWorld({ featureOn: false });
    expect(await expectRejection(service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score()))).toBeInstanceOf(
      FeatureDisabledException,
    );
  });

  test('a student not on the roster cannot be scored', async () => {
    const { service, prisma, caller } = agsWorld();
    prisma.course_student.findFirst.mockResolvedValue(null);
    const err = (await expectRejection(service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score()))) as Error;
    expect(err.message).toContain('not a student');
  });

  test('the write is credited to a current teacher when the item author has left', async () => {
    const { service, prisma, submissions, caller } = agsWorld();
    const original = prisma.lti_line_item.findFirst.getMockImplementation()!;
    prisma.lti_line_item.findFirst.mockImplementation(async (args: any) => {
      const row = await original(args);
      return row ? { ...row, resource_link: { created_by: randomUUID() } } : null;
    });
    await service.postScore(caller, COURSE_ID, LINE_ITEM_ID, score());
    expect(submissions.grade.mock.calls[0][0]).toBe(TEACHER_ID);
  });

  test('parseScore validates the body', () => {
    expect(() => parseScore({ ...score(), activityProgress: 'Done' })).toThrow();
    expect(() => parseScore({ ...score(), timestamp: 'yesterday' })).toThrow();
    expect(() => parseScore({ ...score(), scoreMaximum: 0 })).toThrow();
    expect(() => parseScore({ ...score(), scoreGiven: -1 })).toThrow();
    expect(parseScore(score()).scoreGiven).toBe(7);
  });
});

// ── feature flag, CSRF ──────────────────────────────────────────────────────

describe('feature flag and CSRF scope', () => {
  test('organisation routes answer 403 FEATURE_DISABLED while lti is off', async () => {
    const guard = new LtiOrganisationFeatureGuard(features(false));
    expect(await expectRejection(guard.canActivate())).toBeInstanceOf(FeatureDisabledException);
    expect(await new LtiOrganisationFeatureGuard(features(true)).canActivate()).toBe(true);
  });

  test('only the LTI auth endpoint is exempt from the origin check', () => {
    const forged = (url: string) => ({
      method: 'POST',
      url,
      headers: { origin: 'https://tool.example.org', cookie: 'gb_session=x' },
      cookies: { gb_session: 'gbs_0000000000000000000000000000000000000000000' },
    });
    expect(csrfViolation(forged('/api/lti/auth'))).toBeNull();
    expect(csrfViolation(forged('/api/lti/auth?x=1'))).toBeNull();
    expect(csrfViolation(forged('/api/lti/token'))).not.toBeNull();
    expect(csrfViolation(forged('/api/courses/x/lti/launches'))).not.toBeNull();
  });

  test('form bodies are accepted only on the SAML ACS and the LTI auth and token endpoints', () => {
    const run = (url: string) => {
      let result: { err: Error | null; body?: unknown } = { err: null };
      formBodyParser({ url }, Buffer.from('a=1'), (err, body) => (result = { err, body }));
      return result;
    };
    expect(run('/api/lti/auth').body).toEqual({ a: '1' });
    expect(run('/api/lti/token').body).toEqual({ a: '1' });
    expect(run('/api/lti/ags/courses/x/lineitems').err).not.toBeNull();
    expect(run('/api/courses').err).not.toBeNull();
  });
});
