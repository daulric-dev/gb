import { BadRequestException } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';

/**
 * Per-webhook TLS settings. By default (`verify_tls` true) an https delivery
 * checks the receiver's certificate against the public roots, as before. A
 * school whose receiver has a private-CA or self-signed certificate can
 * trust a CA bundle instead (`tls_ca_cert`: the safe option) or, for
 * testing, turn verification off (deliveries can then be read or changed in
 * transit: audited, alerted, and marked on each delivery). Plain http URLs
 * have no TLS; these settings do not apply to them.
 *
 * The sender passes them to Node's HTTPS request (`rejectUnauthorized` and
 * `ca`), which Bun supports in the backend's Node-compatible runtime.
 */

export const MAX_CA_BYTES = 64 * 1024;

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;

export interface CaBundle {
  /** Normalised PEM: each certificate re-encoded, one after another. */
  pem: string;
  /** SHA-256 fingerprints (`AB:CD:...`), in bundle order. */
  fingerprints: string[];
}

/**
 * A CA bundle as entered: one or more X.509 certificates in PEM, at most
 * MAX_CA_BYTES. Anything else (a private key, other PEM blocks, stray text,
 * a certificate that does not parse) is refused. Throws 400.
 */
export function parseCaBundle(raw: string): CaBundle {
  if (Buffer.byteLength(raw, 'utf8') > MAX_CA_BYTES) {
    throw new BadRequestException(`The CA certificate can be at most ${MAX_CA_BYTES / 1024} KB`);
  }
  const blocks: string[] = raw.match(PEM_BLOCK) ?? [];
  if (/PRIVATE KEY-----/.test(raw)) {
    throw new BadRequestException('That contains a private key: paste only the CA certificate (never a key)');
  }
  const leftover = raw.replace(PEM_BLOCK, '').trim();
  if (blocks.length === 0 || leftover) {
    throw new BadRequestException(
      'Paste one or more PEM certificates (-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----)',
    );
  }
  const certs = blocks.map((block, i) => {
    if (!block.startsWith('-----BEGIN CERTIFICATE-----')) {
      throw new BadRequestException(`Block ${i + 1} is not a certificate: paste only certificates`);
    }
    try {
      return new X509Certificate(block);
    } catch {
      throw new BadRequestException(`Certificate ${i + 1} could not be read: check it was copied whole`);
    }
  });
  return {
    pem: certs.map((c) => c.toString().trim()).join('\n') + '\n',
    fingerprints: certs.map((c) => c.fingerprint256),
  };
}

/** Fingerprints of a stored (already normalised) bundle; empty for none or unreadable. */
export function caFingerprints(pem: string | null | undefined): string[] {
  if (!pem) return [];
  try {
    return parseCaBundle(pem).fingerprints;
  } catch {
    return [];
  }
}

export interface WebhookTls {
  verify: boolean;
  /** Normalised PEM, or null for the public roots. */
  ca: string | null;
}

/** TLS options consumed by the webhook HTTPS transport. */
export interface FetchTlsOptions {
  rejectUnauthorized: boolean;
  ca?: string;
}

export const isHttps = (url: string) => url.toLowerCase().startsWith('https:');

/** The fetch `tls` option for a delivery: undefined for plain http (no TLS). */
export function fetchTlsOptions(url: string, tls: WebhookTls | undefined): FetchTlsOptions | undefined {
  if (!isHttps(url)) return undefined;
  const verify = tls?.verify ?? true;
  return { rejectUnauthorized: verify, ...(tls?.ca ? { ca: tls.ca } : {}) };
}
