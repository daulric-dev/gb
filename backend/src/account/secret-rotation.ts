import type { PrismaService } from '@/prisma/prisma.service';
import type { StorageService } from '@/storage/storage.service';
import { dataEncryptionKey } from './secret';
import { isSealedWithCurrentDataKey } from './secret-box';
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
 *   school_webhook_header.value_enc and school_sso_provider.client_secret_enc
 *   is decrypted and written again as `v2` (DATA_ENCRYPTION_KEY);
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
  'webhookSecrets' | 'webhookHeaders' | 'ssoSecrets' | 'erasureLog',
  RotationCount
>;

type Db = Pick<PrismaService, 'school_webhook' | 'school_webhook_header' | 'school_sso_provider'>;
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
  const report = { webhookSecrets: empty(), webhookHeaders: empty(), ssoSecrets: empty() };

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
