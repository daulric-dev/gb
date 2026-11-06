import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { dataEncryptionKey } from './secret';
import { dataKeyId, isSealedWithCurrentDataKey, openSecret, sealSecret, storedKeyId } from './secret-box';
import { reencryptStoredSecrets, resignErasureLog } from './secret-rotation';
import {
  decryptWebhookHeaderValue,
  decryptWebhookSecret,
  encryptWebhookSecret,
} from '@/integrations/webhooks/webhook-secret';
import { decryptSsoSecret } from '@/sso/sso-secret';
import { signEntry, stableStringify, verifyEntry, type ErasureEntry } from '@/erasure/erasure-log.service';

const AUTH_A = 'a'.repeat(40);
const AUTH_B = 'b'.repeat(40);
const DEK = 'd'.repeat(40);
const SCHOOL = '11111111-1111-4111-8111-111111111111';
const WEBHOOK = '22222222-2222-4222-8222-222222222222';
const HEADER = '33333333-3333-4333-8333-333333333333';

const saved = { AUTH_SECRET: process.env.AUTH_SECRET, DEK: process.env.DATA_ENCRYPTION_KEY, PREFIX: process.env.ERASURE_LOG_S3_PREFIX };
afterAll(() => {
  for (const [k, v] of [
    ['AUTH_SECRET', saved.AUTH_SECRET],
    ['DATA_ENCRYPTION_KEY', saved.DEK],
    ['ERASURE_LOG_S3_PREFIX', saved.PREFIX],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  process.env.AUTH_SECRET = AUTH_A;
  delete process.env.DATA_ENCRYPTION_KEY;
  delete process.env.ERASURE_LOG_S3_PREFIX;
});

/** The pre-DATA_ENCRYPTION_KEY implementation, verbatim: what is in existing rows. */
function legacySeal(authSecret: string, info: string, aad: string, plaintext: string): string {
  const key = Buffer.from(hkdfSync('sha256', authSecret, Buffer.alloc(0), info, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

const webhookAad = `school:${SCHOOL}\nwebhook:${WEBHOOK}`;
const legacyWebhook = (auth = AUTH_A) => legacySeal(auth, 'gradebook:webhook-secret:v1', webhookAad, 'whsec_old');
const legacyHeader = (auth = AUTH_A) =>
  legacySeal(auth, 'gradebook:webhook-header:v1', `${webhookAad}\nheader:${HEADER}`, 'Bearer old');
const legacySso = (auth = AUTH_A) =>
  legacySeal(auth, 'gradebook:school-sso-secret:v1', `school:${SCHOOL}\nprovider:google`, 'sso-old');

const OWNER = { schoolId: SCHOOL, webhookId: WEBHOOK };
const HOWNER = { ...OWNER, headerId: HEADER };
const SOWNER = { schoolId: SCHOOL, provider: 'google' };

describe('DATA_ENCRYPTION_KEY', () => {
  test('unset is null; shorter than 32 characters is an error', () => {
    expect(dataEncryptionKey()).toBeNull();
    process.env.DATA_ENCRYPTION_KEY = 'short';
    expect(() => dataEncryptionKey()).toThrow(/32/);
    process.env.DATA_ENCRYPTION_KEY = DEK;
    expect(dataEncryptionKey()).toBe(DEK);
  });
});

describe('old-format (v1, AUTH_SECRET) values', () => {
  test('existing values decrypt as before, with or without DATA_ENCRYPTION_KEY', () => {
    const [w, h, s] = [legacyWebhook(), legacyHeader(), legacySso()];
    expect(decryptWebhookSecret(OWNER, w)).toBe('whsec_old');
    expect(decryptWebhookHeaderValue(HOWNER, h)).toBe('Bearer old');
    expect(decryptSsoSecret(SOWNER, s)).toBe('sso-old');
    process.env.DATA_ENCRYPTION_KEY = DEK;
    expect(decryptWebhookSecret(OWNER, w)).toBe('whsec_old');
    expect(decryptWebhookHeaderValue(HOWNER, h)).toBe('Bearer old');
    expect(decryptSsoSecret(SOWNER, s)).toBe('sso-old');
    expect(storedKeyId(w)).toBe('auth');
  });

  test('without DATA_ENCRYPTION_KEY new values are still v1 under AUTH_SECRET (unchanged behaviour)', () => {
    const enc = encryptWebhookSecret(OWNER, 'whsec_new');
    expect(enc.split(':')).toHaveLength(4);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptWebhookSecret(OWNER, enc)).toBe('whsec_new');
  });
});

describe('new-format (v2, DATA_ENCRYPTION_KEY) values', () => {
  test('round-trip, tagged with the key id, bound to the AAD and the info', () => {
    process.env.DATA_ENCRYPTION_KEY = DEK;
    const aad = Buffer.from('row:1');
    const enc = sealSecret('info:a', aad, 'hello');
    expect(enc.startsWith(`v2:${dataKeyId(DEK)}:`)).toBe(true);
    expect(enc).not.toContain(DEK);
    expect(isSealedWithCurrentDataKey(enc)).toBe(true);
    expect(openSecret('info:a', aad, enc)).toBe('hello');
    expect(openSecret('info:b', aad, enc)).toBeNull();
    expect(openSecret('info:a', Buffer.from('row:2'), enc)).toBeNull();
    expect(openSecret('info:a', aad, 'v2:zz:garbage')).toBeNull();
  });

  test('does not depend on AUTH_SECRET; another DATA_ENCRYPTION_KEY (or none) cannot read it', () => {
    process.env.DATA_ENCRYPTION_KEY = DEK;
    const enc = encryptWebhookSecret(OWNER, 'whsec_new');
    process.env.AUTH_SECRET = AUTH_B;
    expect(decryptWebhookSecret(OWNER, enc)).toBe('whsec_new');
    process.env.DATA_ENCRYPTION_KEY = 'e'.repeat(40);
    expect(decryptWebhookSecret(OWNER, enc)).toBeNull();
    delete process.env.DATA_ENCRYPTION_KEY;
    expect(decryptWebhookSecret(OWNER, enc)).toBeNull();
  });
});

/** Minimal Prisma stand-in for the three secret tables (updateMany with the compare-and-set where). */
function fakeDb() {
  const webhooks = [{ id: WEBHOOK, school_id: SCHOOL, secret_enc: legacyWebhook() }];
  const headers = [{ id: HEADER, webhook_id: WEBHOOK, value_enc: legacyHeader(), webhook: { school_id: SCHOOL } }];
  const sso = [{ school_id: SCHOOL, provider: 'google', client_secret_enc: legacySso() as string | null }];
  return {
    rows: { webhooks, headers, sso },
    school_webhook: {
      findMany: async () => webhooks.map((w) => ({ ...w })),
      updateMany: async ({ where, data }: { where: { id: string; secret_enc: string }; data: { secret_enc: string } }) => {
        const row = webhooks.find((w) => w.id === where.id && w.secret_enc === where.secret_enc);
        if (row) row.secret_enc = data.secret_enc;
        return { count: row ? 1 : 0 };
      },
    },
    school_webhook_header: {
      findMany: async () => headers.map((h) => ({ ...h })),
      updateMany: async ({ where, data }: { where: { id: string; value_enc: string }; data: { value_enc: string } }) => {
        const row = headers.find((h) => h.id === where.id && h.value_enc === where.value_enc);
        if (row) row.value_enc = data.value_enc;
        return { count: row ? 1 : 0 };
      },
    },
    school_sso_provider: {
      findMany: async () => sso.filter((r) => r.client_secret_enc !== null).map((r) => ({ ...r })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { school_id: string; provider: string; client_secret_enc: string };
        data: { client_secret_enc: string };
      }) => {
        const row = sso.find(
          (r) => r.school_id === where.school_id && r.provider === where.provider && r.client_secret_enc === where.client_secret_enc,
        );
        if (row) row.client_secret_enc = data.client_secret_enc;
        return { count: row ? 1 : 0 };
      },
    },
  };
}

const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
function entry(): Omit<ErasureEntry, 'sig'> {
  return {
    v: 1,
    id: ENTRY_ID,
    occurred_at: '2026-11-01T00:00:00.000Z',
    kind: 'student',
    subject_table: 'student.student',
    subject_ids: [SCHOOL],
    school_id: SCHOOL,
    actor: 'system',
    reason: 'request',
    replay: { steps: [] },
  } as unknown as Omit<ErasureEntry, 'sig'>;
}
/** The pre-DATA_ENCRYPTION_KEY signature: HMAC key derived from AUTH_SECRET. */
function legacySig(auth: string, e: Omit<ErasureEntry, 'sig'>): string {
  const key = createHmac('sha256', auth).update('gradebook:erasure-log:v1').digest();
  return createHmac('sha256', key).update(stableStringify(e)).digest('base64url');
}

function fakeStore(objects: Map<string, string>) {
  return {
    listKeys: async (prefix: string) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
    getBuffer: async (key: string) => (objects.has(key) ? Buffer.from(objects.get(key)!) : null),
    put: async (key: string, body: string | Buffer | Uint8Array) => {
      objects.set(key, body.toString());
    },
  };
}

describe('erasure-log signatures', () => {
  test('existing entries stay verifiable when DATA_ENCRYPTION_KEY is added; new ones are signed with it', () => {
    const e = entry();
    const old = { ...e, sig: legacySig(AUTH_A, e) } as ErasureEntry;
    expect(verifyEntry(old)).toBe(true);
    process.env.DATA_ENCRYPTION_KEY = DEK;
    expect(verifyEntry(old)).toBe(true);
    const fresh = { ...e, sig: signEntry(e) } as ErasureEntry;
    expect(fresh.sig).not.toBe(old.sig);
    expect(verifyEntry(fresh)).toBe(true);
    process.env.AUTH_SECRET = AUTH_B;
    expect(verifyEntry(fresh)).toBe(true);
    expect(verifyEntry({ ...fresh, actor: 'someone-else' })).toBe(false);
  });
});

describe('rotation: DATA_ENCRYPTION_KEY, re-encrypt, then a new AUTH_SECRET', () => {
  test('the script refuses without DATA_ENCRYPTION_KEY', async () => {
    await expect(reencryptStoredSecrets(fakeDb() as never)).rejects.toThrow(/DATA_ENCRYPTION_KEY/);
  });

  test('every secret and signature survives the AUTH_SECRET rotation', async () => {
    const db = fakeDb();
    const objects = new Map<string, string>();
    const e = entry();
    const key = 'erasure-log/2026/11/01/x.json';
    objects.set(key, JSON.stringify({ ...e, sig: legacySig(AUTH_A, e) }));
    objects.set('erasure-log/2026/11/01/bad.json', JSON.stringify({ ...e, sig: 'forged' }));

    // 1. Set DATA_ENCRYPTION_KEY: old values still readable.
    process.env.DATA_ENCRYPTION_KEY = DEK;

    // A dry run changes nothing.
    const dry = await reencryptStoredSecrets(db as never, { dryRun: true });
    expect(dry.webhookSecrets.rewritten).toBe(1);
    expect(db.rows.webhooks[0].secret_enc.startsWith('v1:')).toBe(true);

    // 2. Re-encrypt and re-sign.
    const report = await reencryptStoredSecrets(db as never);
    expect(report.webhookSecrets).toMatchObject({ scanned: 1, rewritten: 1, failed: 0 });
    expect(report.webhookHeaders).toMatchObject({ scanned: 1, rewritten: 1, failed: 0 });
    expect(report.ssoSecrets).toMatchObject({ scanned: 1, rewritten: 1, failed: 0 });
    const log = await resignErasureLog(fakeStore(objects));
    expect(log).toMatchObject({ scanned: 2, rewritten: 1, failed: 1 });
    expect(JSON.parse(objects.get('erasure-log/2026/11/01/bad.json')!).sig).toBe('forged');

    // Idempotent.
    const again = await reencryptStoredSecrets(db as never);
    expect(again.webhookSecrets).toMatchObject({ rewritten: 0, current: 1 });
    expect((await resignErasureLog(fakeStore(objects))).current).toBe(1);

    // 3. Rotate AUTH_SECRET: everything still reads.
    process.env.AUTH_SECRET = AUTH_B;
    expect(decryptWebhookSecret(OWNER, db.rows.webhooks[0].secret_enc)).toBe('whsec_old');
    expect(decryptWebhookHeaderValue(HOWNER, db.rows.headers[0].value_enc)).toBe('Bearer old');
    expect(decryptSsoSecret(SOWNER, db.rows.sso[0].client_secret_enc!)).toBe('sso-old');
    expect(verifyEntry(JSON.parse(objects.get(key)!))).toBe(true);
  });

  test('without the re-encrypt, rotating AUTH_SECRET loses v1 values (why the script exists)', () => {
    process.env.DATA_ENCRYPTION_KEY = DEK;
    const w = legacyWebhook();
    process.env.AUTH_SECRET = AUTH_B;
    expect(decryptWebhookSecret(OWNER, w)).toBeNull();
  });

  test('a value changed while the script runs is left to its new value', async () => {
    process.env.DATA_ENCRYPTION_KEY = DEK;
    const db = fakeDb();
    const original = db.school_webhook.findMany;
    db.school_webhook.findMany = async () => {
      const rows = await original();
      db.rows.webhooks[0].secret_enc = encryptWebhookSecret(OWNER, 'whsec_changed');
      return rows;
    };
    const report = await reencryptStoredSecrets(db as never);
    expect(report.webhookSecrets.raced).toBe(1);
    expect(decryptWebhookSecret(OWNER, db.rows.webhooks[0].secret_enc)).toBe('whsec_changed');
  });
});
