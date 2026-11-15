import type { PrismaService } from '@/prisma/prisma.service';
import type { StorageService } from '@/storage/storage.service';
import { dataEncryptionKey } from './secret';
import { isSealedWithCurrentDataKey, openSecret, sealSecret } from './secret-box';
import { MFA_SECRET_INFO } from '@/mfa/mfa.service';
import { AI_KEY_INFO, aiKeyAad } from '@/ai/ai.constants';
import { TRANSLATION_KEY_AAD, TRANSLATION_KEY_INFO } from '@/translation/translation.constants';
import { ROSTER_SECRET_INFO, rosterSecretAad } from '@/rostering/rostering.constants';
import { LTI_PLATFORM_KEY_INFO } from '@/lti/platform-key.service';
import { decryptWebhookHeaderValue, decryptWebhookSecret, encryptWebhookHeaderValue, encryptWebhookSecret } from '@/integrations/webhooks/webhook-secret';
import { decryptSsoSecret, encryptSsoSecret } from '@/sso/sso-secret';
import { entrySigningKey, signEntry } from '@/erasure/erasure-log.service';
import { erasureLogPrefix, signingKey } from '@/erasure/erasure.config';
import { isEntry } from '@/erasure/erasure-replay.service';

/**
 * Moving stored secrets off AUTH_SECRET onto DATA_ENCRYPTION_KEY, so
 * AUTH_SECRET can then be rotated (run by scripts/reencrypt-secrets.ts, with
 * the *current* AUTH_SECRET and the new DATA_ENCRYPTION_KEY both set):
 *
 * - every `v1` value (AUTH_SECRET) in school_webhook.secret_enc,
 *   school_webhook_header.value_enc, school_sso_provider.client_secret_enc,
 *   mfa_totp.secret_enc and .pending_secret_enc (authenticator secrets),
 *   ai_provider.api_key_enc, translation_setting.key_enc,
 *   roster_source.client_secret_enc and lti_platform_key.private_key_sealed
 *   is decrypted and written again as `v2` (DATA_ENCRYPTION_KEY), each with
 *   its own purpose and additional data, as the owning service seals it;
 * - every erasure-log copy in object storage signed with the AUTH_SECRET key
 *   is signed again with the DATA_ENCRYPTION_KEY one (only when its current
 *   signature verifies, so nothing unverified gains a valid signature).
 *
 * Idempotent: values already under the current data key are skipped. Each
 * row is updated only if it still holds the value that was read, so a secret
 * changed meanwhile is left to its new value. Values that cannot be
 * decrypted (AUTH_SECRET already changed, or a corrupt row) are counted and
 * left alone: they were already unusable, and must be entered again.
 */
export interface RotationCount {
  scanned: number;
  rewritten: number;
  current: number;
  /** Could not be decrypted / verified: left as they are. */
  failed: number;
  /** Changed by someone else between read and write: left to the new value. */
  raced: number;
}

export type SecretRotationReport = Record<
  | 'webhookSecrets'
  | 'webhookHeaders'
  | 'ssoSecrets'
  | 'mfaSecrets'
  | 'aiProviderKeys'
  | 'translationKeys'
  | 'rosterSecrets'
  | 'ltiPlatformKeys'
  | 'erasureLog',
  RotationCount
>;

type Db = Pick<
  PrismaService,
  | 'school_webhook'
  | 'school_webhook_header'
  | 'school_sso_provider'
  | 'mfa_totp'
  | 'ai_provider'
  | 'translation_setting'
  | 'roster_source'
  | 'lti_platform_key'
>;
type Store = Pick<StorageService, 'listKeys' | 'getBuffer' | 'put'>;

const empty = (): RotationCount => ({ scanned: 0, rewritten: 0, current: 0, failed: 0, raced: 0 });

/** Decrypt-and-reseal one stored value, or say why not. */
function reseal(
  stored: string,
  open: (s: string) => string | null,
  seal: (plain: string) => string,
): { next: string } | 'current' | 'failed' {
  if (isSealedWithCurrentDataKey(stored)) return 'current';
  const plain = open(stored);
  if (plain === null) return 'failed';
  return { next: seal(plain) };
}

async function apply(
  count: RotationCount,
  result: ReturnType<typeof reseal>,
  dryRun: boolean,
  write: (next: string) => Promise<{ count: number }>,
): Promise<void> {
  count.scanned++;
  if (result === 'current') count.current++;
  else if (result === 'failed') count.failed++;
  else if (dryRun) count.rewritten++;
  else if ((await write(result.next)).count === 1) count.rewritten++;
  else count.raced++;
}

export async function reencryptStoredSecrets(
  db: Db,
  opts: { dryRun?: boolean } = {},
): Promise<Omit<SecretRotationReport, 'erasureLog'>> {
  if (!dataEncryptionKey()) throw new Error('DATA_ENCRYPTION_KEY is not set: nothing to re-encrypt to');
  const dryRun = !!opts.dryRun;
  const report = {
    webhookSecrets: empty(),
    webhookHeaders: empty(),
    ssoSecrets: empty(),
    mfaSecrets: empty(),
    aiProviderKeys: empty(),
    translationKeys: empty(),
    rosterSecrets: empty(),
    ltiPlatformKeys: empty(),
  };
  /** Reseal one secret-box value under `info` with `aad`. */
  const box = (stored: string, info: string, aad: Buffer) =>
    reseal(stored, (v) => openSecret(info, aad, v), (p) => sealSecret(info, aad, p));

  const webhooks = await db.school_webhook.findMany({ select: { id: true, school_id: true, secret_enc: true } });
  for (const w of webhooks) {
    const owner = { schoolId: w.school_id, webhookId: w.id };
    await apply(
      report.webhookSecrets,
      reseal(w.secret_enc, (s) => decryptWebhookSecret(owner, s), (p) => encryptWebhookSecret(owner, p)),
      dryRun,
      (next) => db.school_webhook.updateMany({ where: { id: w.id, secret_enc: w.secret_enc }, data: { secret_enc: next } }),
    );
  }

  const headers = await db.school_webhook_header.findMany({
    select: { id: true, webhook_id: true, value_enc: true, webhook: { select: { school_id: true } } },
  });
  for (const h of headers) {
    const owner = { schoolId: h.webhook.school_id, webhookId: h.webhook_id, headerId: h.id };
    await apply(
      report.webhookHeaders,
      reseal(h.value_enc, (s) => decryptWebhookHeaderValue(owner, s), (p) => encryptWebhookHeaderValue(owner, p)),
      dryRun,
      (next) =>
        db.school_webhook_header.updateMany({ where: { id: h.id, value_enc: h.value_enc }, data: { value_enc: next } }),
    );
  }

  const sso = await db.school_sso_provider.findMany({
    where: { client_secret_enc: { not: null } },
    select: { school_id: true, provider: true, client_secret_enc: true },
  });
  for (const r of sso) {
    const stored = r.client_secret_enc as string;
    const owner = { schoolId: r.school_id, provider: r.provider };
    await apply(
      report.ssoSecrets,
      reseal(stored, (s) => decryptSsoSecret(owner, s), (p) => encryptSsoSecret(owner, p)),
      dryRun,
      (next) =>
        db.school_sso_provider.updateMany({
          where: { school_id: r.school_id, provider: r.provider, client_secret_enc: stored },
          data: { client_secret_enc: next },
        }),
    );
  }

  // Authenticator secrets: the active one and a pending (being set up) one.
  const totp = await db.mfa_totp.findMany({
    where: { OR: [{ secret_enc: { not: null } }, { pending_secret_enc: { not: null } }] },
    select: { user_id: true, secret_enc: true, pending_secret_enc: true },
  });
  for (const r of totp) {
    const aad = Buffer.from(r.user_id);
    for (const column of ['secret_enc', 'pending_secret_enc'] as const) {
      const stored = r[column];
      if (!stored) continue;
      await apply(report.mfaSecrets, box(stored, MFA_SECRET_INFO, aad), dryRun, (next) =>
        db.mfa_totp.updateMany({ where: { user_id: r.user_id, [column]: stored }, data: { [column]: next } }),
      );
    }
  }

  const ai = await db.ai_provider.findMany({ select: { id: true, api_key_enc: true } });
  for (const r of ai) {
    const stored = r.api_key_enc;
    if (!stored) continue;
    await apply(report.aiProviderKeys, box(stored, AI_KEY_INFO, aiKeyAad(r.id)), dryRun, (next) =>
      db.ai_provider.updateMany({ where: { id: r.id, api_key_enc: stored }, data: { api_key_enc: next } }),
    );
  }

  const translation = await db.translation_setting.findMany({
    where: { key_enc: { not: null } },
    select: { id: true, key_enc: true },
  });
  for (const r of translation) {
    const stored = r.key_enc as string;
    await apply(report.translationKeys, box(stored, TRANSLATION_KEY_INFO, TRANSLATION_KEY_AAD), dryRun, (next) =>
      db.translation_setting.updateMany({ where: { id: r.id, key_enc: stored }, data: { key_enc: next } }),
    );
  }

  const roster = await db.roster_source.findMany({
    where: { client_secret_enc: { not: null } },
    select: { id: true, client_secret_enc: true },
  });
  for (const r of roster) {
    const stored = r.client_secret_enc as string;
    await apply(report.rosterSecrets, box(stored, ROSTER_SECRET_INFO, rosterSecretAad(r.id)), dryRun, (next) =>
      db.roster_source.updateMany({ where: { id: r.id, client_secret_enc: stored }, data: { client_secret_enc: next } }),
    );
  }

  const lti = await db.lti_platform_key.findMany({ select: { kid: true, private_key_sealed: true } });
  for (const r of lti) {
    const stored = r.private_key_sealed;
    await apply(report.ltiPlatformKeys, box(stored, LTI_PLATFORM_KEY_INFO, Buffer.from(r.kid)), dryRun, (next) =>
      db.lti_platform_key.updateMany({
        where: { kid: r.kid, private_key_sealed: stored },
        data: { private_key_sealed: next },
      }),
    );
  }
  return report;
}

/** Re-sign the erasure-log copies in object storage under the current signing key. */
export async function resignErasureLog(store: Store, opts: { dryRun?: boolean } = {}): Promise<RotationCount> {
  if (!dataEncryptionKey()) throw new Error('DATA_ENCRYPTION_KEY is not set: nothing to re-sign with');
  const count = empty();
  const prefix = erasureLogPrefix();
  if (!prefix) return count;
  const target = signingKey();
  for (const key of await store.listKeys(`${prefix}/`)) {
    if (!key.endsWith('.json')) continue;
    const buf = await store.getBuffer(key);
    if (!buf) continue;
    count.scanned++;
    let entry: unknown;
    try {
      entry = JSON.parse(buf.toString('utf8'));
    } catch {
      count.failed++;
      continue;
    }
    if (!isEntry(entry)) {
      count.failed++;
      continue;
    }
    const signedWith = entrySigningKey(entry);
    if (!signedWith) count.failed++;
    else if (signedWith.equals(target)) count.current++;
    else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sig, ...rest } = entry;
      if (!opts.dryRun) {
        await store.put(key, JSON.stringify({ ...rest, sig: signEntry(rest, target) }), 'application/json');
      }
      count.rewritten++;
    }
  }
  return count;
}
