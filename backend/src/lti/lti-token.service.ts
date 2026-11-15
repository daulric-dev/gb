import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { FeatureService } from '@/features/feature.service';
import { isUniqueViolation } from '@/common/db-values';
import { ToolKeyError, ToolKeyService } from './tool-key.service';
import { JwtError, checkClaims, decodeJwt, verifySignature, type DecodedJwt } from './jwt';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AGS_SCOPES,
  CLIENT_ASSERTION_TYPE,
  CLOCK_SKEW_SECONDS,
  MAX_ASSERTION_LIFETIME_SECONDS,
  platformEndpoints,
  toolRateLimit,
} from './lti.constants';
import { randomToken, sha256 } from './lti-values';

/** An OAuth 2 error response (RFC 6749 section 5.2). */
export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly description: string,
  ) {
    super(description);
  }
}

export interface AgsCaller {
  toolId: string;
  scopes: string[];
}

/**
 * Per-tool request budget on the token and AGS endpoints (a fixed one-minute
 * window in the shared cache; LTI_TOOL_RATE_LIMIT, default 300). On a cache
 * failure requests go through: the global per-IP throttler still applies.
 */
@Injectable()
export class LtiRateLimiter {
  private readonly logger = new Logger(LtiRateLimiter.name);

  constructor(private readonly cache: CacheService) {}

  async allow(toolId: string): Promise<boolean> {
    const window = Math.floor(Date.now() / 60_000);
    try {
      const count = await this.cache.incr(`lti:rate:${toolId}:${window}`, 120);
      return count <= toolRateLimit();
    } catch (error) {
      this.logger.warn(`LTI rate limit check failed: ${(error as Error).message}`);
      return true;
    }
  }
}

export class LtiRateLimitedException extends HttpException {
  constructor() {
    super('Too many requests from this tool; slow down', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * The AGS token endpoint: OAuth 2 client credentials where the tool
 * authenticates with a JWT signed by its own key (private_key_jwt, RFC 7523).
 * Issues short-lived opaque bearer tokens (only their SHA-256 is stored) for
 * the AGS scopes the tool asked for.
 */
@Injectable()
export class LtiTokenService {
  private readonly logger = new Logger(LtiTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly toolKeys: ToolKeyService,
    private readonly limiter: LtiRateLimiter,
  ) {}

  async issue(body: Record<string, unknown>) {
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k]) : undefined);
    if (str('grant_type') !== 'client_credentials') {
      throw new OAuthError(400, 'unsupported_grant_type', 'grant_type must be client_credentials');
    }
    if (str('client_assertion_type') !== CLIENT_ASSERTION_TYPE) {
      throw new OAuthError(400, 'invalid_request', `client_assertion_type must be ${CLIENT_ASSERTION_TYPE}`);
    }
    const assertion = str('client_assertion');
    if (!assertion) throw new OAuthError(400, 'invalid_request', 'client_assertion is required');

    let decoded: DecodedJwt;
    try {
      decoded = decodeJwt(assertion);
    } catch (error) {
      throw new OAuthError(401, 'invalid_client', (error as Error).message);
    }
    const iss = decoded.payload.iss;
    if (typeof iss !== 'string' || decoded.payload.sub !== iss) {
      throw new OAuthError(401, 'invalid_client', 'iss and sub must both be the client id');
    }
    const tool = await this.prisma.lti_tool.findUnique({
      where: { client_id: iss },
      select: { id: true, enabled: true, ags_enabled: true, jwks_url: true, public_key_pem: true },
    });
    if (!tool || !tool.enabled) throw new OAuthError(401, 'invalid_client', 'Unknown or disabled client');
    if (!(await this.features.isEnabled(null, 'lti'))) {
      throw new OAuthError(403, 'unauthorized_client', 'External tools (LTI) are turned off');
    }
    if (!tool.ags_enabled) throw new OAuthError(400, 'unauthorized_client', 'Grade services are not enabled for this tool');
    if (!(await this.limiter.allow(tool.id))) {
      throw new OAuthError(429, 'slow_down', 'Too many requests from this tool');
    }

    try {
      const key = await this.toolKeys.keyFor(tool, decoded.header.kid);
      if (!verifySignature(decoded, key)) throw new JwtError('Bad signature');
      const { tokenUrl, issuer } = platformEndpoints();
      checkClaims(decoded.payload, {
        audience: [tokenUrl, issuer],
        skewSeconds: CLOCK_SKEW_SECONDS,
        maxLifetimeSeconds: MAX_ASSERTION_LIFETIME_SECONDS,
      });
    } catch (error) {
      if (error instanceof JwtError || error instanceof ToolKeyError) {
        throw new OAuthError(401, 'invalid_client', error.message);
      }
      throw error;
    }

    const jti = decoded.payload.jti;
    if (typeof jti !== 'string' || !jti || jti.length > 512) {
      throw new OAuthError(401, 'invalid_client', 'jti is required');
    }
    try {
      await this.prisma.lti_replay.create({
        data: {
          tool_id: tool.id,
          kind: 'jti',
          value: jti,
          expires_at: new Date(((decoded.payload.exp as number) + CLOCK_SKEW_SECONDS) * 1000),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new OAuthError(401, 'invalid_client', 'This client assertion was already used');
      throw error;
    }

    const requested = (str('scope') ?? '').split(/\s+/).filter(Boolean);
    const scopes = [...new Set(requested.filter((s) => AGS_SCOPES.includes(s)))];
    if (scopes.length === 0) throw new OAuthError(400, 'invalid_scope', 'Ask for at least one AGS scope');

    const token = randomToken();
    await this.prisma.lti_access_token.create({
      data: {
        token_hash: sha256(token),
        tool_id: tool.id,
        scopes,
        expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(' '),
    };
  }

  /** The tool behind a bearer token, or null when it is missing, unknown or expired. */
  async resolve(authorization: string | undefined): Promise<AgsCaller | null> {
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/i.exec(authorization?.trim() ?? '');
    if (!match) return null;
    const row = await this.prisma.lti_access_token.findUnique({
      where: { token_hash: sha256(match[1]) },
      select: { tool_id: true, scopes: true, expires_at: true, tool: { select: { enabled: true, ags_enabled: true } } },
    });
    if (!row || row.expires_at.getTime() <= Date.now()) return null;
    if (!row.tool.enabled || !row.tool.ags_enabled) return null;
    return { toolId: row.tool_id, scopes: stringList(row.scopes) };
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
