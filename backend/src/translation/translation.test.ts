import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import translate from 'translate';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { AuthGuard } from '@/auth/auth.guard';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { openSecret } from '@/account/secret-box';
import {
  ISO_639_1,
  MAX_TEXTS,
  TRANSLATION_CACHE_TTL,
  TRANSLATION_KEY_AAD,
  TRANSLATION_KEY_INFO,
  callSize,
  languageName,
  normaliseLanguage,
} from './translation.constants';
import {
  AUTO,
  TranslationUrlError,
  assertLibreDestination,
  callEngine,
  deeplEngine,
  libreEndpoint,
  type EngineConfig,
} from './translation-engine';
import {
  TranslationService,
  assertLimits,
  cacheKey,
  isTranslatable,
  planJobs,
  runPool,
  splitLong,
  splitWhitespace,
  translateBatch,
} from './translation.service';
import { TranslationSettingsService } from './translation-settings.service';
import { ActivityTranslationService } from './activity-translation.service';
import { TranslationOrgFeatureGuard } from './translation-feature.guard';
import {
  ActivityTranslationController,
  OrganisationTranslationController,
  TranslationController,
} from './translation.controller';
import { TranslateTextsDto, TranslationSettingsDto } from './translation.dto';
import { UNCONTRACTED_ENGINES, engineAllowed, engineDisplayName, uncontractedEnginesAllowed } from './engine-policy';

const USER = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const rejected = async (p: Promise<unknown>) => (await expectRejection(p)) as Error;
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const privateResolver = async () => [{ address: '10.0.0.5', family: 4 }];

// ── fetch mock ───────────────────────────────────────────────────────────

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Google-shaped answers: the translation is the text upper-cased (line by line). */
function mockGoogle(transform: (q: string) => string = (q) => q.toUpperCase()) {
  calls = [];
  globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    calls.push({ url: String(url), init: init ?? {} });
    const q = u.searchParams.get('q') ?? '';
    return new Response(JSON.stringify([[[transform(q), q]]]), { status: 200 });
  }) as unknown as typeof fetch;
}

// Most tests use the Google engine (keyless, easy to mock), which this
// server only allows with the flag; `uncontracted engines` tests without it.
const FLAG = 'TRANSLATION_ALLOW_UNCONTRACTED_ENGINES';
const savedFlag = process.env[FLAG];
beforeEach(() => {
  process.env[FLAG] = 'true';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

const GOOGLE: EngineConfig = { engine: 'google', url: null, key: null, allowPrivateNetwork: false };

// ── languages and limits ─────────────────────────────────────────────────

describe('validation and limits', () => {
  test('ISO 639-1 codes, region dropped', () => {
    expect(normaliseLanguage('es')).toBe('es');
    expect(normaliseLanguage('zh-CN')).toBe('zh');
    expect(normaliseLanguage('pt-BR')).toBe('pt');
    expect(normaliseLanguage('pt_br')).toBe('pt');
    expect(normaliseLanguage('EN')).toBe('en');
    expect(normaliseLanguage('english')).toBeNull();
    expect(normaliseLanguage('xx')).toBeNull();
    expect(normaliseLanguage('auto')).toBeNull();
    expect(normaliseLanguage(42)).toBeNull();
    expect(languageName('es')).toBe('Spanish');
  });

  test('every code we accept is one the package accepts', () => {
    const languages = (translate as unknown as { languages: (c: string) => string }).languages;
    for (const code of ISO_639_1) expect(languages(code)).toBe(code);
  });

  test('count, per-text and total limits', () => {
    expect(() => assertLimits(Array(MAX_TEXTS).fill('a'))).not.toThrow();
    expect(() => assertLimits(Array(MAX_TEXTS + 1).fill('a'))).toThrow(BadRequestException);
    expect(() => assertLimits(['a'.repeat(5_001)])).toThrow(/5000 characters/);
    expect(() => assertLimits(Array(11).fill('a'.repeat(4_999)))).toThrow(/50000 characters per request/);
    expect(() => assertLimits([1 as unknown as string])).toThrow(BadRequestException);
  });

  test('the DTO refuses too many or too long texts', async () => {
    const tooMany = plainToInstance(TranslateTextsDto, { texts: Array(201).fill('a'), to: 'es' });
    expect((await validate(tooMany)).length).toBeGreaterThan(0);
    const tooLong = plainToInstance(TranslateTextsDto, { texts: ['a'.repeat(5_001)], to: 'es' });
    expect((await validate(tooLong)).length).toBeGreaterThan(0);
    const ok = plainToInstance(TranslateTextsDto, { texts: ['Hello'], to: 'zh-CN' });
    expect(await validate(ok)).toEqual([]);
  });

  test('blank and letter-free strings are not translatable; whitespace is split off', () => {
    expect(isTranslatable('')).toBe(false);
    expect(isTranslatable('12.5 %')).toBe(false);
    expect(isTranslatable('—')).toBe(false);
    expect(isTranslatable('Größe')).toBe(true);
    expect(isTranslatable('你好')).toBe(true);
    expect(splitWhitespace('  Hello \n')).toEqual({ lead: '  ', core: 'Hello', trail: ' \n' });
  });
});

// ── batching ─────────────────────────────────────────────────────────────

describe('batching', () => {
  const upper = (calls: string[]) => async (text: string) => {
    calls.push(text);
    return text.toUpperCase();
  };

  test('misses are joined with newlines into one call and split back, order kept', async () => {
    const sent: string[] = [];
    const out = await translateBatch(['one', ' two ', '', '42', 'three', 'one'], {
      cache: createMockCacheService(),
      call: upper(sent),
      engine: 'google',
      scope: { url: null, from: AUTO, to: 'es' },
    });
    expect(out).toEqual(['ONE', ' TWO ', '', '42', 'THREE', 'ONE']);
    expect(sent).toEqual(['one\ntwo\nthree']);
  });

  test('a joined answer with the wrong number of lines falls back to one call per string', async () => {
    const sent: string[] = [];
    const out = await translateBatch(['a b', 'c d', 'e f'], {
      cache: createMockCacheService(),
      call: async (text) => {
        sent.push(text);
        return text.includes('\n') ? 'merged into one line' : `<${text}>`;
      },
      engine: 'google',
      scope: { url: null, from: 'en', to: 'es' },
    });
    expect(out).toEqual(['<a b>', '<c d>', '<e f>']);
    expect(sent).toEqual(['a b\nc d\ne f', 'a b', 'c d', 'e f']);
  });

  test('google calls stay under ~1,800 encoded characters; texts with line breaks go alone', () => {
    const texts = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} with ünïcödé`);
    const jobs = planJobs([...texts, 'two\nlines'], 'google');
    for (const job of jobs) {
      const text = job.kind === 'batch' ? job.items.join('\n') : job.text;
      expect(callSize('google', text)).toBeLessThanOrEqual(1_800);
    }
    expect(jobs.length).toBeGreaterThan(2);
    expect(jobs).toContainEqual({ kind: 'single', text: 'two\nlines' });
    expect(jobs.flatMap((j) => (j.kind === 'batch' ? j.items : [j.text])).sort()).toEqual([...texts, 'two\nlines'].sort());
  });

  test('a text over the per-call size is split into pieces that fit and join back', () => {
    const long = Array.from({ length: 120 }, (_, i) => `Phrase ${i} is here.`).join(' ');
    const pieces = splitLong(long, 'google');
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(long);
    for (const p of pieces) expect(callSize('google', p)).toBeLessThanOrEqual(1_800);
    const cjk = '字'.repeat(1_000);
    const cjkPieces = splitLong(cjk, 'google');
    expect(cjkPieces.join('')).toBe(cjk);
    for (const p of cjkPieces) expect(callSize('google', p)).toBeLessThanOrEqual(1_800);
  });

  test('concurrency is limited', async () => {
    let running = 0;
    let peak = 0;
    await runPool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(4);
  });

  test('cache hits skip the engine; misses are cached for 30 days', async () => {
    mockGoogle();
    const cache = createMockCacheService();
    const deps = {
      cache,
      engine: 'google' as const,
      scope: { url: null, from: 'en', to: 'es' },
      call: (text: string) => callEngine(GOOGLE, text, { from: 'en', to: 'es' }),
    };
    expect(await translateBatch(['Hello', 'World'], deps)).toEqual(['HELLO', 'WORLD']);
    expect(calls.length).toBe(1);
    const entry = cache._store.get(cacheKey('google', null, 'en', 'es', 'Hello'));
    expect(entry).toEqual({ value: 'HELLO', ttl: TRANSLATION_CACHE_TTL });

    expect(await translateBatch(['Hello', ' World'], deps)).toEqual(['HELLO', ' WORLD']);
    expect(calls.length).toBe(1);
    // Another language is another key.
    expect(cacheKey('google', null, 'en', 'fr', 'Hello')).not.toBe(cacheKey('google', null, 'en', 'es', 'Hello'));
  });
});

// ── engines ──────────────────────────────────────────────────────────────

describe('engines', () => {
  test('google: sl=auto when the source is detected, and a signal on every request', async () => {
    mockGoogle();
    expect(await callEngine(GOOGLE, 'Hello', { from: AUTO, to: 'es' })).toBe('HELLO');
    const u = new URL(calls[0].url);
    expect(u.hostname).toBe('translate.googleapis.com');
    expect(u.searchParams.get('sl')).toBe('auto');
    expect(u.searchParams.get('tl')).toBe('es');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test('deepl: key in the Authorization header, never the URL; free keys go to api-free', async () => {
    calls = [];
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ translations: [{ text: 'Hola' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const cfg: EngineConfig = { engine: 'deepl', url: null, key: 'secret-key:fx', allowPrivateNetwork: false };
    expect(await callEngine(cfg, 'Hello', { from: 'en', to: 'es' })).toBe('Hola');
    expect(calls[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect(calls[0].url).not.toContain('secret');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key secret-key:fx');
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get('text')).toBe('Hello');
    expect(body.get('target_lang')).toBe('ES');
    expect(body.get('source_lang')).toBe('EN');
    expect(body.get('auth_key')).toBeNull();

    const [paidUrl, init] = deeplEngine(AUTO).fetch({ key: 'paid', from: 'xx', to: 'de', text: 'Hi' });
    expect(paidUrl).toBe('https://api.deepl.com/v2/translate');
    expect(new URLSearchParams(String(init.body)).get('source_lang')).toBeNull();
  });

  test('deepl: a refused key is an AUTH error with its status', async () => {
    globalThis.fetch = mock(async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    const err = await rejected(
      callEngine({ engine: 'deepl', url: null, key: 'bad', allowPrivateNetwork: false }, 'Hello', { from: 'en', to: 'es' }),
    );
    expect((err as { code?: string }).code).toBe('AUTH');
    expect((err as { status?: number }).status).toBe(403);
  });

  test('engine errors never carry the text', async () => {
    globalThis.fetch = mock(async (url: string) => {
      throw new TypeError(`fetch failed for ${url}`);
    }) as unknown as typeof fetch;
    const err = await rejected(callEngine(GOOGLE, 'secret pupil text', { from: 'en', to: 'es' }));
    expect(err.message).not.toContain('secret');
    expect(err.message).not.toContain('pupil');
  });

  test('a timeout aborts the request', async () => {
    globalThis.fetch = mock(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    ) as unknown as typeof fetch;
    const err = await rejected(callEngine(GOOGLE, 'Hello', { from: 'en', to: 'es', timeoutMs: 20 }));
    expect((err as { code?: string }).code).toBe('TIMEOUT');
  });
});

// ── SSRF ─────────────────────────────────────────────────────────────────

describe('LibreTranslate address (SSRF)', () => {
  test('private addresses are refused unless the private network is allowed', async () => {
    const err = await rejected(assertLibreDestination('https://libre.example.org', false, privateResolver));
    expect(err).toBeInstanceOf(TranslationUrlError);
    expect(err.message).toMatch(/private or reserved/);
    expect(await assertLibreDestination('http://10.0.0.5:5000', true, privateResolver)).toBe('http://10.0.0.5:5000/translate');
    await expect(assertLibreDestination('https://127.0.0.1', false)).rejects.toBeInstanceOf(TranslationUrlError);
    await expect(assertLibreDestination('https://[::1]/', false)).rejects.toBeInstanceOf(TranslationUrlError);
  });

  test('http(s) only, https unless private network, no credentials', async () => {
    await expect(assertLibreDestination('ftp://libre.example.org', true, publicResolver)).rejects.toBeInstanceOf(TranslationUrlError);
    await expect(assertLibreDestination('http://libre.example.org', false, publicResolver)).rejects.toThrow(/https/);
    await expect(assertLibreDestination('https://u:p@libre.example.org', false, publicResolver)).rejects.toThrow(/user name or password/);
    await expect(assertLibreDestination(null, false, publicResolver)).rejects.toBeInstanceOf(TranslationUrlError);
    expect(await assertLibreDestination('https://libre.example.org/', false, publicResolver)).toBe('https://libre.example.org/translate');
    expect(libreEndpoint('https://x.org/api/translate')).toBe('https://x.org/api/translate');
  });

  test('a refused address is never fetched', async () => {
    mockGoogle();
    const cfg: EngineConfig = { engine: 'libre', url: 'https://127.0.0.1:5000', key: null, allowPrivateNetwork: false };
    await expect(callEngine(cfg, 'Hello', { from: 'en', to: 'es' })).rejects.toBeInstanceOf(TranslationUrlError);
    expect(calls.length).toBe(0);
  });

  test('an allowed address is called with a JSON body', async () => {
    calls = [];
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ translatedText: 'Hola' }), { status: 200 });
    }) as unknown as typeof fetch;
    const cfg: EngineConfig = { engine: 'libre', url: 'http://127.0.0.1:5000', key: null, allowPrivateNetwork: true };
    expect(await callEngine(cfg, 'Hello', { from: AUTO, to: 'es' })).toBe('Hola');
    expect(calls[0].url).toBe('http://127.0.0.1:5000/translate');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ q: 'Hello', source: 'auto', target: 'es' });
    expect(calls[0].init.redirect).toBe('error');
  });
});

// ── service: feature switch and settings ─────────────────────────────────

function settingsRow(over: Record<string, unknown> = {}) {
  return {
    engine: 'google',
    url: null,
    key_enc: null,
    allow_private_network: false,
    enabled: true,
    updated_at: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function makeService(prisma: MockPrisma, cache = createMockCacheService()) {
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const settings = new TranslationSettingsService(prisma as any);
  return { service: new TranslationService(settings, features, cache as any), settings, features, cache };
}

describe('feature switch', () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, account_type: 'staff' });
    prisma.school.findUnique.mockResolvedValue({ disabled_feature_rows: [] });
    prisma.translation_setting.findUnique.mockResolvedValue(settingsRow());
  });

  test('feature off => status false and FEATURE_DISABLED, engine never called', async () => {
    mockGoogle();
    prisma.organisation.findFirst.mockResolvedValue({ features: {} });
    const { service } = makeService(prisma);
    expect(await service.status(USER)).toEqual({ enabled: false, engine: null });
    const err = await rejected(service.translateForUser(USER, { texts: ['Hello'], to: 'es' }));
    expect(err).toBeInstanceOf(FeatureDisabledException);
    expect(((err as HttpException).getResponse() as { code: string }).code).toBe('FEATURE_DISABLED');
    expect(calls.length).toBe(0);
  });

  test('switched off by the school => off', async () => {
    prisma.organisation.findFirst.mockResolvedValue({ features: { translation: true } });
    prisma.school.findUnique.mockResolvedValue({ disabled_feature_rows: [{ feature: 'translation' }] } as any);
    const { service } = makeService(prisma);
    expect(await service.status(USER)).toEqual({ enabled: false, engine: null });
  });

  test('feature on but the organisation settings disabled (or missing) => off', async () => {
    prisma.organisation.findFirst.mockResolvedValue({ features: { translation: true } });
    prisma.translation_setting.findUnique.mockResolvedValue(settingsRow({ enabled: false }));
    const { service } = makeService(prisma);
    expect(await service.status(USER)).toEqual({ enabled: false, engine: null });
    await expect(service.translateForUser(USER, { texts: ['Hello'], to: 'es' })).rejects.toBeInstanceOf(FeatureDisabledException);
    prisma.translation_setting.findUnique.mockResolvedValue(null);
    expect(await service.status(USER)).toEqual({ enabled: false, engine: null });
  });

  test('both on => translations in order, zh-CN accepted as zh', async () => {
    mockGoogle();
    prisma.organisation.findFirst.mockResolvedValue({ features: { translation: true } });
    const { service } = makeService(prisma);
    expect(await service.status(USER)).toEqual({ enabled: true, engine: 'Google Translate' });
    const out = await service.translateForUser(USER, { texts: ['Hello', '', 'Bye'], to: 'zh-CN' });
    expect(out).toEqual({ translations: ['HELLO', '', 'BYE'] });
    expect(new URL(calls[0].url).searchParams.get('tl')).toBe('zh');
    await expect(service.translateForUser(USER, { texts: ['Hello'], to: 'klingon' })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('an engine failure is a 502 TRANSLATION_FAILED', async () => {
    globalThis.fetch = mock(async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
    prisma.organisation.findFirst.mockResolvedValue({ features: { translation: true } });
    const { service } = makeService(prisma);
    const err = (await rejected(service.translateForUser(USER, { texts: ['Hello'], to: 'es' }))) as HttpException;
    expect(err.getStatus()).toBe(502);
    expect((err.getResponse() as { code: string }).code).toBe('TRANSLATION_FAILED');
  });
});

describe('organisation settings', () => {
  let prisma: MockPrisma;
  let saved: any;
  beforeEach(() => {
    prisma = createMockPrisma();
    saved = null;
    prisma.translation_setting.findUnique.mockImplementation(async () => saved);
    prisma.translation_setting.upsert.mockImplementation(async ({ create, update }: any) => {
      saved = { ...(saved ? { ...saved, ...update } : create), updated_at: new Date() };
      return saved;
    });
  });

  const put = (settings: TranslationSettingsService, dto: Partial<TranslationSettingsDto>) =>
    settings.update({ engine: 'google', enabled: true, ...dto } as TranslationSettingsDto, USER);

  test('defaults without a row; never the key', async () => {
    const settings = new TranslationSettingsService(prisma as any);
    expect(await settings.get()).toEqual({
      engine: 'libre', url: null, hasKey: false, allowPrivateNetwork: false, enabled: false, updatedAt: null,
      uncontractedEnginesAllowed: true, engineBlocked: false,
    });
    const view = await put(settings, { engine: 'deepl', key: 'my-deepl-key' });
    expect(view).toMatchObject({ engine: 'deepl', hasKey: true, enabled: true });
    expect(JSON.stringify(view)).not.toContain('my-deepl-key');
    expect(saved.key_enc).not.toContain('my-deepl-key');
    expect(openSecret(TRANSLATION_KEY_INFO, TRANSLATION_KEY_AAD, saved.key_enc)).toBe('my-deepl-key');
  });

  test('deepl and yandex need a key when enabled; omitted keeps, null clears, another engine drops it', async () => {
    const settings = new TranslationSettingsService(prisma as any);
    await expect(put(settings, { engine: 'deepl' })).rejects.toThrow(/DeepL needs an API key/);
    await expect(put(settings, { engine: 'yandex', key: '  ' })).rejects.toThrow(/Yandex needs an API key/);
    expect((await put(settings, { engine: 'deepl', enabled: false })).enabled).toBe(false);

    await put(settings, { engine: 'deepl', key: 'k1' });
    expect((await put(settings, { engine: 'deepl' })).hasKey).toBe(true);
    await expect(put(settings, { engine: 'deepl', key: null })).rejects.toBeInstanceOf(BadRequestException);
    expect((await put(settings, { engine: 'deepl', key: null, enabled: false })).hasKey).toBe(false);

    await put(settings, { engine: 'deepl', key: 'k2' });
    expect((await put(settings, { engine: 'google' })).hasKey).toBe(false);
  });

  test('libre needs a valid URL; other engines store none', async () => {
    const settings = new TranslationSettingsService(prisma as any);
    await expect(put(settings, { engine: 'libre' })).rejects.toThrow(/address of its server/);
    await expect(put(settings, { engine: 'libre', url: 'http://libre.local' })).rejects.toThrow(/https/);
    await expect(put(settings, { engine: 'libre', url: 'https://u:p@libre.org' })).rejects.toThrow(/password/);
    expect((await put(settings, { engine: 'libre', url: 'http://libre.local:5000', allowPrivateNetwork: true })).url).toBe(
      'http://libre.local:5000',
    );
    // Turning the private network off must not leave an http address behind.
    await expect(put(settings, { engine: 'libre', allowPrivateNetwork: false })).rejects.toThrow(/https/);
    expect((await put(settings, { engine: 'google', url: 'https://ignored.example' })).url).toBeNull();
  });

  test('the test translates "Hello" to Spanish with the saved settings only', async () => {
    mockGoogle(() => 'Hola');
    const { service } = makeService(prisma);
    expect(await service.test()).toEqual({ ok: false, message: 'Save the translation settings first.' });
    saved = settingsRow({ enabled: false });
    expect(await service.test()).toEqual({ ok: true, sample: 'Hola' });
    expect(new URL(calls[0].url).searchParams.get('tl')).toBe('es');
    saved = settingsRow({ engine: 'libre', url: 'https://127.0.0.1' });
    const refused = await service.test();
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/private or reserved/);
  });
});

describe('uncontracted engines (Google, Yandex)', () => {
  let prisma: MockPrisma;
  let saved: any;
  beforeEach(() => {
    delete process.env[FLAG];
    prisma = createMockPrisma();
    saved = settingsRow();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, account_type: 'staff' });
    prisma.school.findUnique.mockResolvedValue({ disabled_feature_rows: [] });
    prisma.organisation.findFirst.mockResolvedValue({ features: { translation: true } });
    prisma.translation_setting.findUnique.mockImplementation(async () => saved);
    prisma.translation_setting.upsert.mockImplementation(async ({ create, update }: any) => {
      saved = { ...(saved ? { ...saved, ...update } : create), updated_at: new Date() };
      return saved;
    });
  });

  test('the flag must be exactly true', () => {
    expect([...UNCONTRACTED_ENGINES].sort()).toEqual(['google', 'yandex']);
    expect(uncontractedEnginesAllowed()).toBe(false);
    for (const v of ['1', 'yes', 'false', '']) {
      process.env[FLAG] = v;
      expect(uncontractedEnginesAllowed()).toBe(false);
    }
    process.env[FLAG] = ' TRUE ';
    expect(uncontractedEnginesAllowed()).toBe(true);
    delete process.env[FLAG];
    expect(engineAllowed('libre')).toBe(true);
    expect(engineAllowed('deepl')).toBe(true);
    expect(engineAllowed('google')).toBe(false);
    expect(engineAllowed('yandex')).toBe(false);
  });

  test('a saved Google or Yandex engine is off without the flag: status, translate, copy config and test send nothing', async () => {
    mockGoogle();
    const { service, settings } = makeService(prisma);
    expect(await service.status(USER)).toEqual({ enabled: false, engine: null });
    await expect(service.translateForUser(USER, { texts: ['Hello'], to: 'es' })).rejects.toBeInstanceOf(FeatureDisabledException);
    expect(await service.activeConfig(SCHOOL)).toBeNull();
    const t = await service.test();
    expect(t.ok).toBe(false);
    expect(t.message).toMatch(/TRANSLATION_ALLOW_UNCONTRACTED_ENGINES/);
    expect(calls.length).toBe(0);
    expect(await settings.get()).toMatchObject({
      engine: 'google',
      enabled: true,
      engineBlocked: true,
      uncontractedEnginesAllowed: false,
    });

    saved = settingsRow({ engine: 'yandex' });
    expect(await service.status(USER)).toEqual({ enabled: false, engine: null });

    // With the flag, the saved engine keeps working.
    process.env[FLAG] = 'true';
    saved = settingsRow();
    expect(await service.status(USER)).toEqual({ enabled: true, engine: 'Google Translate' });
    expect((await settings.get()).engineBlocked).toBe(false);
  });

  test('saving Google or Yandex switched on is refused without the flag; switched off is allowed', async () => {
    const settings = new TranslationSettingsService(prisma as any);
    saved = null;
    await expect(settings.update({ engine: 'google', enabled: true } as TranslationSettingsDto, USER)).rejects.toThrow(
      /not allowed on this server/,
    );
    await expect(
      settings.update({ engine: 'yandex', key: 'k', enabled: true } as TranslationSettingsDto, USER),
    ).rejects.toThrow(/not allowed on this server/);
    expect(saved).toBeNull();
    // An admin can still turn a saved one off.
    expect((await settings.update({ engine: 'google', enabled: false } as TranslationSettingsDto, USER)).enabled).toBe(false);
    expect((await settings.update({ engine: 'deepl', key: 'k', enabled: true } as TranslationSettingsDto, USER)).enabled).toBe(
      true,
    );
  });

  test('status names the service people are told about', async () => {
    const { service } = makeService(prisma);
    saved = settingsRow({ engine: 'libre', url: 'https://translate.example.org/translate' });
    expect(await service.status(USER)).toEqual({ enabled: true, engine: 'LibreTranslate (translate.example.org)' });
    saved = settingsRow({ engine: 'libre', url: 'http://10.0.0.5:5000/translate', allow_private_network: true });
    expect(await service.status(USER)).toEqual({ enabled: true, engine: "LibreTranslate (your school's server)" });
    expect(engineDisplayName('deepl', null, false)).toBe('DeepL');
    expect(engineDisplayName('yandex', null, false)).toBe('Yandex Translate');
    expect(engineDisplayName('libre', 'not a url', false)).toBe('LibreTranslate');
  });
});

// ── routes ───────────────────────────────────────────────────────────────

describe('routes', () => {
  test('organisation routes: admins only, behind the feature guard; saving needs step-up', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OrganisationTranslationController)).toEqual([
      AuthGuard,
      OrganisationAdminGuard,
      TranslationOrgFeatureGuard,
    ]);
    expect(Reflect.getMetadata(STEP_UP_KEY, OrganisationTranslationController.prototype.update)).toBe(true);
    expect(Reflect.getMetadata(STEP_UP_KEY, OrganisationTranslationController.prototype.get)).toBeUndefined();
    expect(Reflect.getMetadata(STEP_UP_KEY, OrganisationTranslationController.prototype.test)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, TranslationController)).toEqual([AuthGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, ActivityTranslationController)).toEqual([AuthGuard]);
  });

  test('the org feature guard answers FEATURE_DISABLED while the organisation has it off', async () => {
    const prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: {} });
    const guard = new TranslationOrgFeatureGuard(new FeatureService(prisma as any, createMockCacheService() as any));
    expect(await rejected(guard.canActivate())).toBeInstanceOf(FeatureDisabledException);
  });

  test('per-route limits use the named route throttler, never default', () => {
    const limit = (fn: unknown, name: string) => Reflect.getMetadata(`THROTTLER:LIMIT${name}`, fn as object);
    expect(limit(TranslationController.prototype.translate, 'route')).toBe(300);
    expect(limit(OrganisationTranslationController.prototype.test, 'route')).toBe(10);
    expect(limit(ActivityTranslationController.prototype.translate, 'route')).toBe(5);
    for (const fn of [
      TranslationController.prototype.translate,
      OrganisationTranslationController.prototype.test,
      ActivityTranslationController.prototype.translate,
    ]) {
      expect(limit(fn, 'default')).toBeUndefined();
    }
  });
});

// ── translated activity copy ─────────────────────────────────────────────

describe('translated activity copy', () => {
  test('every text translated in order; language added to the title; draft copy through ActivityService', async () => {
    const source = {
      activity: { id: 'a1', title: 'Fractions quiz', instructions: 'Answer all.', school_id: SCHOOL, kind: 'quiz' },
      questions: [
        {
          prompt: 'What is a half?',
          quiz_option: [
            { label: '1/2', match_label: null },
            { label: 'One quarter', match_label: 'Quarter' },
          ],
        },
      ],
      draws: [],
    };
    const activities = {
      sourceForCopy: mock(async () => source),
      createCopy: mock(async (_u: string, _s: unknown, text: unknown) => ({ id: 'copy', text })),
    };
    const translation = {
      requireConfig: mock(async (_schoolId: string) => GOOGLE),
      translateWith: mock(async (_cfg: unknown, texts: string[], _from: string, _to: string) => texts.map((t) => (t ? `es:${t}` : t))),
    };
    const svc = new ActivityTranslationService(activities as any, translation as any);
    const out = (await svc.translate(USER, 'c1', 'a1', { to: 'es-MX' })) as any;
    expect(translation.translateWith.mock.calls[0][1]).toEqual([
      'Fractions quiz', 'Answer all.', 'What is a half?', '1/2', '', 'One quarter', 'Quarter',
    ]);
    expect(translation.translateWith.mock.calls[0][2]).toBe(AUTO);
    expect(translation.translateWith.mock.calls[0][3]).toBe('es');
    expect(translation.requireConfig.mock.calls[0][0]).toBe(SCHOOL);
    expect(out.text).toEqual({
      title: 'es:Fractions quiz [Spanish]',
      instructions: 'es:Answer all.',
      questions: [
        {
          prompt: 'es:What is a half?',
          options: [
            { label: 'es:1/2', matchLabel: null },
            { label: 'es:One quarter', matchLabel: 'es:Quarter' },
          ],
        },
      ],
    });
  });

  test('feature off for the course school => FEATURE_DISABLED before anything is sent', async () => {
    const activities = { sourceForCopy: mock(async () => ({ activity: { school_id: SCHOOL }, questions: [] })), createCopy: mock() };
    const translation = {
      requireConfig: mock(async () => {
        throw new FeatureDisabledException('translation');
      }),
      translateWith: mock(),
    };
    const svc = new ActivityTranslationService(activities as any, translation as any);
    await expect(svc.translate(USER, 'c1', 'a1', { to: 'fr' })).rejects.toBeInstanceOf(FeatureDisabledException);
    expect(translation.translateWith).not.toHaveBeenCalled();
    expect(activities.createCopy).not.toHaveBeenCalled();
  });
});

describe('splitWhitespace is linear', () => {
  test('long runs of spaces split quickly and exactly', () => {
    const spaces = ' '.repeat(100_000);
    const started = performance.now();
    expect(splitWhitespace(`${spaces}x${spaces}`)).toEqual({ lead: spaces, core: 'x', trail: spaces });
    expect(splitWhitespace(`a${spaces}b`)).toEqual({ lead: '', core: `a${spaces}b`, trail: '' });
    expect(splitWhitespace(spaces)).toEqual({ lead: spaces, core: '', trail: '' });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
