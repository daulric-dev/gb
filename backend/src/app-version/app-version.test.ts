import { afterEach, describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';
import {
  compareVersions,
  loadAppVersionConfig,
  parseClientVersion,
  parseVersion,
} from './app-version.config';
import { AppVersionController } from './app-version.controller';
import { AppVersionGuard } from './app-version.guard';
import { AppVersionService } from './app-version.service';

const IOS_URL = 'https://apps.apple.com/app/id123';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=gd.gradebook';

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

function withEnv(env: Record<string, string>) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MOBILE_')) delete process.env[key];
  }
  Object.assign(process.env, env);
  return new AppVersionService();
}

function context(url: string, headers: Record<string, string> = {}) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ url, headers }) }),
  } as any;
}

describe('versions', () => {
  test('parse: one to three parts, suffix ignored', () => {
    expect(parseVersion('1.4.2')).toEqual([1, 4, 2]);
    expect(parseVersion('1.4')).toEqual([1, 4, 0]);
    expect(parseVersion('2')).toEqual([2, 0, 0]);
    expect(parseVersion('1.4.2-beta.1')).toEqual([1, 4, 2]);
    for (const bad of ['', 'v1.2', '1.2.3.4', '1..2', 'latest', '1.2.x', null, 3]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  test('compare is numeric, not lexical', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });

  test('client header: platform/version or bare version', () => {
    expect(parseClientVersion('ios/1.2.3')).toEqual({ platform: 'ios', version: '1.2.3' });
    expect(parseClientVersion('Android/2.0')).toEqual({ platform: 'android', version: '2.0' });
    expect(parseClientVersion('1.2.3')).toEqual({ platform: null, version: '1.2.3' });
    expect(parseClientVersion('web/1.2.3')).toBeNull();
    expect(parseClientVersion('ios/nope')).toBeNull();
    expect(parseClientVersion('x'.repeat(100))).toBeNull();
  });
});

describe('loadAppVersionConfig', () => {
  test('nothing set: all nulls', () => {
    const empty = { minimum: null, latest: null, storeUrl: null };
    expect(loadAppVersionConfig({})).toEqual({ ios: empty, android: empty });
  });

  test('platform overrides win over the shared value', () => {
    const config = loadAppVersionConfig({
      MOBILE_MIN_VERSION: '1.0.0',
      MOBILE_LATEST_VERSION: '1.3.0',
      MOBILE_MIN_VERSION_ANDROID: '1.1.0',
      MOBILE_LATEST_VERSION_IOS: '1.4.0',
      MOBILE_IOS_STORE_URL: IOS_URL,
    });
    expect(config.ios).toEqual({ minimum: '1.0.0', latest: '1.4.0', storeUrl: IOS_URL });
    expect(config.android).toEqual({ minimum: '1.1.0', latest: '1.3.0', storeUrl: null });
  });

  test('latest is never below the minimum', () => {
    const warnings: string[] = [];
    const config = loadAppVersionConfig(
      { MOBILE_MIN_VERSION: '2.0.0', MOBILE_LATEST_VERSION: '1.0.0' },
      (m) => warnings.push(m),
    );
    expect(config.ios.latest).toBe('2.0.0');
    expect(warnings).toHaveLength(2);
    // A minimum alone is also the latest.
    expect(loadAppVersionConfig({ MOBILE_MIN_VERSION: '1.2.0' }).android.latest).toBe('1.2.0');
  });

  test('production refuses to boot on a malformed value', () => {
    for (const env of [
      { MOBILE_MIN_VERSION: '1.0.x' },
      { MOBILE_LATEST_VERSION_IOS: 'latest' },
      { MOBILE_IOS_STORE_URL: 'not a url' },
      { MOBILE_ANDROID_STORE_URL: 'http://play.google.com/x' },
    ]) {
      expect(() => loadAppVersionConfig({ NODE_ENV: 'production', ...env })).toThrow();
    }
  });

  test('development warns and treats a malformed value as unset', () => {
    const warnings: string[] = [];
    const config = loadAppVersionConfig(
      { NODE_ENV: 'development', MOBILE_MIN_VERSION: '1.0.x', MOBILE_IOS_STORE_URL: 'ftp://x' },
      (m) => warnings.push(m),
    );
    expect(config.ios.minimum).toBeNull();
    expect(config.ios.storeUrl).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('AppVersionController', () => {
  test('answers the config with a short public cache', () => {
    const service = withEnv({ MOBILE_MIN_VERSION: '1.0.0', MOBILE_ANDROID_STORE_URL: ANDROID_URL });
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => ((headers[k] = v), reply) } as any;
    const body = new AppVersionController(service).version(reply);
    expect(body.android).toEqual({ minimum: '1.0.0', latest: '1.0.0', storeUrl: ANDROID_URL });
    expect(body.ios.storeUrl).toBeNull();
    expect(headers['Cache-Control']).toMatch(/^public, max-age=\d+$/);
  });
});

describe('AppVersionGuard', () => {
  const env = {
    MOBILE_MIN_VERSION_IOS: '1.2.0',
    MOBILE_MIN_VERSION_ANDROID: '1.3.0',
    MOBILE_IOS_STORE_URL: IOS_URL,
  };

  function refusal(guard: AppVersionGuard, url: string, version: string) {
    try {
      guard.canActivate(context(url, { 'x-gradebook-app-version': version }));
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      return err as HttpException;
    }
  }

  test('a build below its platform minimum gets 426 with the store', () => {
    const guard = new AppVersionGuard(withEnv(env));
    const err = refusal(guard, '/api/portal/me', 'ios/1.1.9');
    expect(err?.getStatus()).toBe(426);
    expect(err?.getResponse()).toMatchObject({ code: 'update_required', storeUrl: IOS_URL });

    expect(refusal(guard, '/api/portal/me', 'android/1.2.5')?.getResponse()).toMatchObject({
      code: 'update_required',
      storeUrl: null,
    });
  });

  test('current builds, no header, unreadable headers and no minimum pass', () => {
    const guard = new AppVersionGuard(withEnv(env));
    expect(refusal(guard, '/api/portal/me', 'ios/1.2.0')).toBeNull();
    expect(refusal(guard, '/api/portal/me', 'android/1.10.0')).toBeNull();
    expect(refusal(guard, '/api/portal/me', 'garbage')).toBeNull();
    expect(guard.canActivate(context('/api/portal/me'))).toBe(true);

    const open = new AppVersionGuard(withEnv({}));
    expect(refusal(open, '/api/portal/me', 'ios/0.0.1')).toBeNull();
  });

  test('the version check and sign-out stay reachable', () => {
    const guard = new AppVersionGuard(withEnv(env));
    expect(refusal(guard, '/api/app/version', 'ios/0.1.0')).toBeNull();
    expect(refusal(guard, '/api/app/version?x=1', 'ios/0.1.0')).toBeNull();
    expect(refusal(guard, '/api/auth/logout', 'ios/0.1.0')).toBeNull();
    expect(refusal(guard, '/api/auth/me', 'ios/0.1.0')?.getStatus()).toBe(426);
  });

  test('a bare version is held to the lower minimum', () => {
    const guard = new AppVersionGuard(withEnv(env));
    expect(refusal(guard, '/api/x', '1.2.5')).toBeNull();
    expect(refusal(guard, '/api/x', '1.1.0')?.getStatus()).toBe(426);
    // Only one platform has a minimum: a bare version can't be judged.
    const one = new AppVersionGuard(withEnv({ MOBILE_MIN_VERSION_IOS: '2.0.0' }));
    expect(refusal(one, '/api/x', '1.0.0')).toBeNull();
  });
});
