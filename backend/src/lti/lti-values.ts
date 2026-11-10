import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { rsaKeyFromPem } from './jwt';

const CUSTOM_KEY = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Custom parameters: at most 50 string values (1024 characters each) under
 * keys of letters, digits and underscores. Anything else is a 400.
 */
export function normaliseCustomParams(input: unknown): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Custom parameters must be key/value pairs');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 50) throw new BadRequestException('At most 50 custom parameters');
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!CUSTOM_KEY.test(key)) {
      throw new BadRequestException(`Custom parameter names use letters, digits and _ only ("${key.slice(0, 64)}")`);
    }
    if (typeof value !== 'string' || value.length > 1024) {
      throw new BadRequestException(`Custom parameter "${key}" must be text of at most 1024 characters`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * A URL a tool registration may use: https (http only outside production),
 * no credentials, no fragment.
 */
export function assertToolUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(`${label} is not a valid URL`);
  }
  const httpOk = process.env.NODE_ENV !== 'production';
  if (url.protocol !== 'https:' && !(httpOk && url.protocol === 'http:')) {
    throw new BadRequestException(`${label} must use https`);
  }
  if (url.username || url.password) throw new BadRequestException(`${label} must not contain credentials`);
  if (url.hash) throw new BadRequestException(`${label} must not contain a #fragment`);
  return url.toString();
}

/** A pasted PEM: must be an RSA public key of 2048 bits or more. */
export function assertPublicKeyPem(pem: string): string {
  const trimmed = pem.trim();
  if (!rsaKeyFromPem(trimmed)) {
    throw new BadRequestException('The public key must be an RSA public key (2048 bits or more) in PEM format');
  }
  return trimmed;
}

/** Short fingerprint for audit entries (never the key itself). */
export function pemFingerprint(pem: string | null): string | null {
  if (!pem) return null;
  return `sha256:${createHash('sha256').update(pem.trim()).digest('hex').slice(0, 16)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Client ids and deployment ids GradeBook issues. */
export function newClientId(): string {
  return `gb-${randomBytes(12).toString('hex')}`;
}

export function newDeploymentId(): string {
  return `gbd-${randomBytes(8).toString('hex')}`;
}

/** Score scaled onto the activity's points: 2 decimals, within [0, points]. */
export function scaleScore(scoreGiven: number, scoreMaximum: number, points: number): number {
  const scaled = (scoreGiven / scoreMaximum) * points;
  const rounded = Math.round(scaled * 100) / 100;
  return Math.min(points, Math.max(0, rounded));
}
