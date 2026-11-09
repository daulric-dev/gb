import { BadRequestException } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';

export const MAX_CA_BYTES = 64 * 1024;

export interface CaBundle {
  /** Normalised PEM: each certificate re-encoded, one after another. */
  pem: string;
  /** SHA-256 fingerprints (`AB:CD:...`), in bundle order. */
  fingerprints: string[];
}

/**
 * The PEM blocks in a pasted bundle, scanned line by line (linear time, no
 * backtracking regex). Each line is trimmed first, so CRLF or lone-CR line
 * endings, trailing spaces and indentation from copying out of a web page or
 * email are accepted; blank lines between blocks are skipped. Any other text
 * outside a block, or a block without its matching END line, is refused.
 */
function extractPemBlocks(raw: string): string[] {
  const lines = raw.split(/\r\n|\r|\n/).map((line) => line.trim());

  const blocks: string[] = [];
  let current: string[] = [];
  let expectedEnd: string | null = null;

  for (const line of lines) {
    if (expectedEnd === null) {
      if (line === '') continue;

      const match = /^-----BEGIN ([A-Z0-9 ]+)-----$/.exec(line);

      if (!match) {
        throw new BadRequestException(
          'Paste one or more PEM certificates (-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----)',
        );
      }

      current = [line];
      expectedEnd = `-----END ${match[1]}-----`;

      continue;
    }

    current.push(line);

    if (line === expectedEnd) {
      blocks.push(current.join('\n'));
      current = [];
      expectedEnd = null;
    }
  }

  if (expectedEnd !== null) {
    throw new BadRequestException('Incomplete PEM block');
  }

  return blocks;
}

export function parseCaBundle(raw: string): CaBundle {
  if (Buffer.byteLength(raw, 'utf8') > MAX_CA_BYTES) {
    throw new BadRequestException(
      `The CA certificate can be at most ${MAX_CA_BYTES / 1024} KB`,
    );
  }

  if (/PRIVATE KEY-----/.test(raw)) {
    throw new BadRequestException(
      'That contains a private key: paste only the CA certificate (never a key)',
    );
  }

  const blocks = extractPemBlocks(raw);

  if (blocks.length === 0) {
    throw new BadRequestException(
      'Paste one or more PEM certificates (-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----)',
    );
  }

  const certs = blocks.map((block, i) => {
    if (!block.startsWith('-----BEGIN CERTIFICATE-----')) {
      throw new BadRequestException(
        `Block ${i + 1} is not a certificate: paste only certificates`,
      );
    }

    try {
      return new X509Certificate(block);
    } catch {
      throw new BadRequestException(
        `Certificate ${i + 1} could not be read: check it was copied whole`,
      );
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

  return {
    rejectUnauthorized: verify,
    ...(tls?.ca ? { ca: tls.ca } : {}),
  };
}