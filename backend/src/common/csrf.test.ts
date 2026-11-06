import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import {
  CSRF_REJECTION_MESSAGE,
  csrfViolation,
  registerCsrfProtection,
  requestSourceOrigin,
  useBodyParsers,
} from './csrf';

const APP = 'https://app.example.com';
const SESSION = 'gb_session=abc.def';

/** Stand-ins for a cookie-authenticated write and the SAML ACS. */
@Controller()
class TestController {
  @Post('things')
  create(@Body() body: unknown) {
    return { body };
  }

  @Get('things')
  list() {
    return [];
  }

  @Post('auth/sso/saml/acs')
  acs(@Body() body: unknown) {
    return { body };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

let app: NestFastifyApplication;
const savedEnv = { ...process.env };

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    TestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(cookie);
  registerCsrfProtection(app.getHttpAdapter().getInstance());
  useBodyParsers(app);
  app.setGlobalPrefix('api');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  process.env.FRONTEND_URL = `${APP},https://other.example.com`;
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  process.env.FRONTEND_URL = savedEnv.FRONTEND_URL;
  process.env.NODE_ENV = savedEnv.NODE_ENV;
});

function post(
  url: string,
  headers: Record<string, string>,
  payload: unknown = { a: 1 },
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

describe('CSRF origin check', () => {
  test('allows a cookie-authenticated write from an allowed origin', async () => {
    const res = await post('/api/things', { cookie: SESSION, origin: APP });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ body: { a: 1 } });

    const second = await post('/api/things', {
      cookie: SESSION,
      origin: 'https://other.example.com',
    });
    expect(second.statusCode).toBe(201);
  });

  test('refuses a cookie-authenticated write from a foreign origin', async () => {
    const res = await post('/api/things', {
      cookie: SESSION,
      origin: 'https://evil.example.com',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      statusCode: 403,
      message: CSRF_REJECTION_MESSAGE,
      error: 'Forbidden',
    });
  });

  test('refuses a cookie-authenticated write with no origin at all', async () => {
    expect((await post('/api/things', { cookie: SESSION })).statusCode).toBe(403);
    expect(
      (await post('/api/things', { cookie: SESSION, origin: 'null' })).statusCode,
    ).toBe(403);
  });

  test('falls back to the Referer origin when Origin is missing', async () => {
    expect(
      (await post('/api/things', { cookie: SESSION, referer: `${APP}/courses/1` }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await post('/api/things', {
          cookie: SESSION,
          referer: 'https://evil.example.com/x',
        })
      ).statusCode,
    ).toBe(403);
  });

  test('lets the native app through on its bearer token', async () => {
    const res = await post('/api/things', {
      authorization: 'Bearer abc.def',
      'x-gradebook-client': 'native',
    });
    expect(res.statusCode).toBe(201);

    // The app's cookie jar may replay a stale cookie next to the header.
    const withJar = await post('/api/things', {
      cookie: SESSION,
      'x-gradebook-client': 'native',
    });
    expect(withJar.statusCode).toBe(201);
  });

  test('ignores requests without a session cookie and safe methods', async () => {
    expect((await post('/api/things', { origin: 'https://evil.example.com' })).statusCode).toBe(201);
    const get = await app.inject({
      method: 'GET',
      url: '/api/things',
      headers: { cookie: SESSION, origin: 'https://evil.example.com' },
    });
    expect(get.statusCode).toBe(200);
  });

  test('exempts the SAML ACS, which an IdP posts to from its own site', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sso/saml/acs',
      headers: {
        cookie: SESSION,
        origin: 'https://idp.example.org',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'SAMLResponse=PHNhbWw%2B&RelayState=xyz',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      body: { SAMLResponse: 'PHNhbWw+', RelayState: 'xyz' },
    });
  });
});

describe('form bodies', () => {
  test('are refused everywhere but the SAML ACS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/things',
      headers: {
        origin: APP,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'a=1',
    });
    expect(res.statusCode).toBe(415);
  });

  test('JSON still parses as before', async () => {
    const res = await post('/api/things', { origin: APP }, { nested: { x: [1] } });
    expect(res.json()).toEqual({ body: { nested: { x: [1] } } });
    const bad = await post('/api/things', { origin: APP }, '{"__proto__": {"x": 1}}');
    expect(bad.statusCode).toBe(400);
  });
});

describe('csrfViolation', () => {
  const base = { method: 'POST', url: '/api/things', headers: {} };

  test('in development, LAN origins count as ours', () => {
    process.env.NODE_ENV = 'development';
    expect(
      csrfViolation({
        ...base,
        headers: { origin: 'http://192.168.1.20:8081' },
        cookies: { gb_session: 'x' },
      }),
    ).toBeNull();
  });

  test('a bearer header without a cookie is not cookie-authenticated', () => {
    expect(
      csrfViolation({ ...base, headers: { authorization: 'Bearer t' } }),
    ).toBeNull();
  });

  test('reads the Referer origin', () => {
    expect(
      requestSourceOrigin({ ...base, headers: { referer: 'https://a.b/c?d' } }),
    ).toBe('https://a.b');
    expect(requestSourceOrigin({ ...base, headers: { referer: 'nope' } })).toBe(
      undefined,
    );
  });
});
