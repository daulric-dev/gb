import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A throwaway self-signed certificate (and its key) for 127.0.0.1 /
 * localhost, made with the `openssl` CLI for TLS tests. Null when openssl is
 * not installed (the caller skips its live tests).
 */
export function selfSignedCert(cn = 'GradeBook test CA'): { cert: string; key: string } | null {
  const dir = mkdtempSync(join(tmpdir(), 'gb-tls-'));
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '2',
        '-subj', `/CN=${cn}`,
        '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
        '-addext', 'basicConstraints=critical,CA:TRUE',
      ],
      { stdio: 'ignore' },
    );
    return { cert: readFileSync(join(dir, 'cert.pem'), 'utf8'), key: readFileSync(join(dir, 'key.pem'), 'utf8') };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
