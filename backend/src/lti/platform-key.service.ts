import { generateKeyPairSync, createPrivateKey, randomBytes, type KeyObject } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { openSecret, sealSecret } from '@/account/secret-box';
import { isUniqueViolation } from '@/common/db-values';
import { RETIRED_KEY_GRACE_MS } from './lti.constants';
import { signJwt, type JwtPayload } from './jwt';

const KEY_INFO = 'gradebook:lti-platform-key:v1';

export interface PlatformKeySummary {
  kid: string;
  active: boolean;
  createdAt: string;
  retiredAt: string | null;
}

/**
 * GradeBook's RSA signing keys for id_tokens. One is active; a rotation
 * retires it (still published for RETIRED_KEY_GRACE_MS, so tools with a
 * cached JWKS keep verifying) and creates a new one. The private key is
 * sealed with secret-box (DATA_ENCRYPTION_KEY, else AUTH_SECRET) with the
 * kid as additional data; it is created on first use.
 */
@Injectable()
export class PlatformKeyService {
  private readonly logger = new Logger(PlatformKeyService.name);
  private readonly privateKeys = new Map<string, KeyObject>();

  constructor(private readonly prisma: PrismaService) {}

  private newKey() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = randomBytes(16).toString('base64url');
    const jwk = publicKey.export({ format: 'jwk' });
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    return {
      kid,
      public_jwk: { kty: 'RSA', n: String(jwk.n), e: String(jwk.e), kid, alg: 'RS256', use: 'sig' },
      private_key_sealed: sealSecret(KEY_INFO, Buffer.from(kid), pem),
      privateKey,
    };
  }

  /** The active key, creating one when there is none. */
  async activeKey(): Promise<{ kid: string; privateKey: KeyObject }> {
    const row = await this.prisma.lti_platform_key.findFirst({
      where: { active: true },
      select: { kid: true, private_key_sealed: true },
    });
    if (row) return { kid: row.kid, privateKey: this.open(row.kid, row.private_key_sealed) };

    const key = this.newKey();
    try {
      await this.prisma.lti_platform_key.create({
        data: {
          kid: key.kid,
          public_jwk: key.public_jwk,
          private_key_sealed: key.private_key_sealed,
          active: true,
        },
      });
    } catch (error) {
      // Another instance created it first (one active key, unique index).
      if (isUniqueViolation(error)) return this.activeKey();
      throw error;
    }
    this.privateKeys.set(key.kid, key.privateKey);
    return { kid: key.kid, privateKey: key.privateKey };
  }

  private open(kid: string, sealed: string): KeyObject {
    const cached = this.privateKeys.get(kid);
    if (cached) return cached;
    const pem = openSecret(KEY_INFO, Buffer.from(kid), sealed);
    if (!pem) {
      this.logger.error(`LTI platform key ${kid} cannot be decrypted (was DATA_ENCRYPTION_KEY changed?)`);
      throw new Error('LTI platform key cannot be decrypted; rotate the platform key');
    }
    const key = createPrivateKey(pem);
    this.privateKeys.set(kid, key);
    return key;
  }

  async sign(payload: JwtPayload): Promise<string> {
    const { kid, privateKey } = await this.activeKey();
    return signJwt(payload, privateKey, kid);
  }

  /** Retire the active key and make a new one. Returns the new kid. */
  async rotate(): Promise<{ kid: string; retired: string | null }> {
    const key = this.newKey();
    const retired = await this.prisma.$transaction(async (tx) => {
      const current = await tx.lti_platform_key.findFirst({ where: { active: true }, select: { kid: true } });
      await tx.lti_platform_key.updateMany({
        where: { active: true },
        data: { active: false, retired_at: new Date() },
      });
      await tx.lti_platform_key.create({
        data: {
          kid: key.kid,
          public_jwk: key.public_jwk,
          private_key_sealed: key.private_key_sealed,
          active: true,
        },
      });
      return current?.kid ?? null;
    });
    this.privateKeys.set(key.kid, key.privateKey);
    return { kid: key.kid, retired };
  }

  /** The public JWKS: the active key and keys retired within the grace period. */
  async jwks(): Promise<{ keys: Record<string, unknown>[] }> {
    await this.activeKey();
    const rows = await this.prisma.lti_platform_key.findMany({
      where: {
        OR: [{ active: true }, { retired_at: { gt: new Date(Date.now() - RETIRED_KEY_GRACE_MS) } }],
      },
      orderBy: { created_at: 'desc' },
      select: { public_jwk: true },
    });
    return { keys: rows.map((r) => r.public_jwk as Record<string, unknown>) };
  }

  async summaries(): Promise<PlatformKeySummary[]> {
    const rows = await this.prisma.lti_platform_key.findMany({
      where: {
        OR: [{ active: true }, { retired_at: { gt: new Date(Date.now() - RETIRED_KEY_GRACE_MS) } }],
      },
      orderBy: { created_at: 'desc' },
      select: { kid: true, active: true, created_at: true, retired_at: true },
    });
    return rows.map((r) => ({
      kid: r.kid,
      active: r.active,
      createdAt: r.created_at.toISOString(),
      retiredAt: r.retired_at?.toISOString() ?? null,
    }));
  }
}
