import { afterEach, describe, expect, test } from 'bun:test';
import { checkEndpointUrl, fromJson, OneRosterClient, OneRosterError, ONEROSTER_PAGE_SIZE } from './oneroster-client';
import { expectRejection } from '@/test/mocks';

const rejected = async (p: Promise<unknown>) => (await expectRejection(p)) as Error;

const CONFIG = {
  baseUrl: 'https://sis.example.org/ims/oneroster/rostering/v1p2',
  tokenUrl: 'https://sis.example.org/oauth/token',
  clientId: 'client',
  clientSecret: 's3cret',
};

type Call = { url: string; init: RequestInit };

function fakeServer(handler: (url: URL, init: RequestInit, n: number) => Response) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(new URL(url), init, calls.length);
  };
  return { calls, fetch: fetch as any };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const token = () => json({ access_token: 'tok', expires_in: 3600 });

describe('OneRosterClient', () => {
  const prevAllow = process.env.WEBHOOK_ALLOW_PRIVATE;
  afterEach(() => {
    if (prevAllow === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
    else process.env.WEBHOOK_ALLOW_PRIVATE = prevAllow;
  });

  test('client credentials: Basic auth, scope, then Bearer on every page; pages until a short page', async () => {
    const users = Array.from({ length: ONEROSTER_PAGE_SIZE + 3 }, (_, i) => ({ sourcedId: `u${i}` }));
    const server = fakeServer((url) => {
      if (url.pathname.endsWith('/token')) return token();
      const offset = Number(url.searchParams.get('offset'));
      return json({ users: users.slice(offset, offset + ONEROSTER_PAGE_SIZE) });
    });
    const client = new OneRosterClient(CONFIG, { fetch: server.fetch, sleep: async () => {}, minIntervalMs: 0 });
    const out = await client.collection('users', 'users');
    expect(out).toHaveLength(ONEROSTER_PAGE_SIZE + 3);
    const tokenCall = server.calls[0];
    expect(tokenCall.init.method).toBe('POST');
    expect((tokenCall.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('client:s3cret').toString('base64')}`);
    expect(String(tokenCall.init.body)).toContain('grant_type=client_credentials');
    expect(String(tokenCall.init.body)).toContain('roster-core.readonly');
    const pages = server.calls.slice(1);
    expect(pages.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', String(ONEROSTER_PAGE_SIZE)]);
    expect((pages[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    // Redirects are never followed.
    expect(pages[0].init.redirect).toBe('manual');
  });

  test('429 and 5xx back off (Retry-After honoured) and retry', async () => {
    const slept: number[] = [];
    const server = fakeServer((url, _init, n) => {
      if (url.pathname.endsWith('/token')) return token();
      if (n === 2) return json({}, 429, { 'retry-after': '3' });
      if (n === 3) return json({}, 503);
      return json({ orgs: [{ sourcedId: 'o1' }] });
    });
    const client = new OneRosterClient(CONFIG, { fetch: server.fetch, sleep: async (ms) => void slept.push(ms), minIntervalMs: 0 });
    expect(await client.collection('orgs', 'orgs')).toEqual([{ sourcedId: 'o1' }]);
    expect(slept).toEqual([3000, 2000]);
  });

  test('gives up after the retries with the last status', async () => {
    const server = fakeServer((url) => (url.pathname.endsWith('/token') ? token() : json({}, 500)));
    const client = new OneRosterClient(CONFIG, { fetch: server.fetch, sleep: async () => {}, minIntervalMs: 0 });
    const err = await rejected(client.collection('orgs', 'orgs'));
    expect(err).toBeInstanceOf(OneRosterError);
    expect(err.message).toContain('HTTP 500');
  });

  test('a 401 on a page refreshes the token once', async () => {
    let tokens = 0;
    const server = fakeServer((url, init) => {
      if (url.pathname.endsWith('/token')) return json({ access_token: `tok${++tokens}`, expires_in: 3600 });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer tok1' ? json({}, 401) : json({ orgs: [] });
    });
    const client = new OneRosterClient(CONFIG, { fetch: server.fetch, sleep: async () => {}, minIntervalMs: 0 });
    expect(await client.collection('orgs', 'orgs')).toEqual([]);
    expect(tokens).toBe(2);
  });

  test('bad credentials and redirects are clear errors', async () => {
    const bad = fakeServer(() => json({ error: 'invalid_client' }, 401));
    const c1 = new OneRosterClient(CONFIG, { fetch: bad.fetch, sleep: async () => {}, minIntervalMs: 0 });
    expect((await rejected(c1.test())).message).toBe('The OneRoster server refused the client ID or secret');

    const moved = fakeServer(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    const c2 = new OneRosterClient(CONFIG, { fetch: moved.fetch, sleep: async () => {}, minIntervalMs: 0 });
    expect((await rejected(c2.accessToken())).message).toContain('redirects');
    expect(moved.calls).toHaveLength(1); // never followed
  });

  test('SSRF guard: private, loopback and link-local destinations are refused before any request', async () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
    for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]']) {
      const client = new OneRosterClient(
        { ...CONFIG, baseUrl: `https://${host}/ims/oneroster/rostering/v1p2`, tokenUrl: `https://${host}/token` },
        { sleep: async () => {}, minIntervalMs: 0 }, // the real, guarded transport
      );
      const err = await rejected(client.accessToken());
      expect(err.message).toContain('private or reserved address');
    }
  });

  test('URLs: https only (http only when private destinations are allowed), no credentials in the URL', () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
    expect(() => checkEndpointUrl('http://sis.example.org/x')).toThrow('must use https');
    expect(() => checkEndpointUrl('file:///etc/passwd')).toThrow('must use https');
    expect(() => checkEndpointUrl('https://u:p@sis.example.org/')).toThrow('user name or password');
    expect(() => checkEndpointUrl('nonsense')).toThrow('not a valid URL');
    expect(checkEndpointUrl('https://sis.example.org/x').hostname).toBe('sis.example.org');
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    expect(checkEndpointUrl('http://sis.local/x').protocol).toBe('http:');
  });
});

describe('fromJson (1.1 and 1.2 shapes)', () => {
  test('roles[] with orgs, class refs, enrolment refs; tobedeleted and disabled dropped', () => {
    const snap = fromJson({
      orgs: [{ sourcedId: 'o1', name: 'North' }, { sourcedId: 'o2', status: 'tobedeleted' }],
      sessions: [{ sourcedId: 'y', title: '2026', type: 'schoolYear', startDate: '2026-09-01', endDate: '2027-07-01' }],
      users: [
        { sourcedId: 'u1', enabledUser: true, givenName: 'Ada', familyName: 'L', email: 'ADA@x.org', roles: [{ role: 'teacher', org: { sourcedId: 'o1' } }] },
        { sourcedId: 'u2', enabledUser: 'false', givenName: 'Off', familyName: 'X', roles: [{ role: 'student', org: { sourcedId: 'o1' } }] },
        { sourcedId: 'u3', givenName: 'Old', familyName: 'Style', role: 'student', orgs: [{ sourcedId: 'o1' }], identifier: '77' },
      ],
      classes: [{ sourcedId: 'c1', title: 'Maths', school: { sourcedId: 'o1' }, terms: [{ sourcedId: 'y' }] }],
      enrollments: [{ sourcedId: 'e1', role: 'student', class: { sourcedId: 'c1' }, user: { sourcedId: 'u3' } }],
    });
    expect(snap.orgs.map((o) => o.sourcedId)).toEqual(['o1']);
    expect(snap.users.map((u) => [u.sourcedId, u.kind, u.email, u.identifier])).toEqual([
      ['u1', 'staff', 'ada@x.org', null],
      ['u3', 'student', null, '77'],
    ]);
    expect(snap.classes[0]).toMatchObject({ schoolSourcedId: 'o1', termSourcedIds: ['y'] });
    expect(snap.enrollments).toEqual([{ sourcedId: 'e1', classSourcedId: 'c1', userSourcedId: 'u3', role: 'student' }]);
  });
});
