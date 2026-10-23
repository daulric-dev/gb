import { readFileSync } from 'node:fs';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * Well-known providers. Each needs only a username and an app password
 * (Google, Microsoft, Yahoo, iCloud and Zoho all refuse the account's normal
 * password over SMTP once two-step verification is on).
 */
export const SMTP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'smtp.gmail.com', port: 465 },
  google: { host: 'smtp.gmail.com', port: 465 },
  outlook: { host: 'smtp.office365.com', port: 587 },
  office365: { host: 'smtp.office365.com', port: 587 },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465 },
  icloud: { host: 'smtp.mail.me.com', port: 587 },
  zoho: { host: 'smtp.zoho.com', port: 465 },
};

/** Providers that issue app passwords as space-separated groups. */
const GROUPED_APP_PASSWORD_HOSTS = new Set([
  'smtp.gmail.com',
  'smtp.mail.yahoo.com',
  'smtp.mail.me.com',
]);

type Env = Record<string, string | undefined>;

/**
 * Build the SMTP transport from the environment. Two ways to configure it:
 *
 * - `SMTP_URL` - one URL (`smtps://user:pass@host:465`). The password must be
 *   URL-encoded, which is easy to get wrong with app passwords.
 * - Separate fields - `SMTP_SERVICE` (a preset above) or `SMTP_HOST`/`SMTP_PORT`,
 *   plus `SMTP_USER` and `SMTP_PASSWORD` (or `SMTP_PASSWORD_FILE` for a
 *   mounted secret). Nothing needs encoding. `SMTP_SECURE` forces implicit
 *   TLS on or off; by default it is on for port 465 and STARTTLS otherwise.
 *
 * `SMTP_URL` wins when both are set. Returns null when nothing is configured.
 */
export function smtpOptions(
  env: Env = process.env,
): string | SMTPTransport.Options | null {
  if (env.SMTP_URL) return env.SMTP_URL;

  const service = env.SMTP_SERVICE?.trim().toLowerCase();
  const preset = service ? SMTP_PRESETS[service] : undefined;
  if (service && !preset) {
    throw new Error(
      `Unknown SMTP_SERVICE "${env.SMTP_SERVICE}". Use one of ${Object.keys(SMTP_PRESETS).join(', ')}, or set SMTP_HOST.`,
    );
  }

  const host = env.SMTP_HOST?.trim() || preset?.host;
  if (!host) return null;

  const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : (preset?.port ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`SMTP_PORT "${env.SMTP_PORT}" is not a valid port`);
  }
  const secure =
    env.SMTP_SECURE !== undefined ? isTrue(env.SMTP_SECURE) : port === 465;

  const user = env.SMTP_USER?.trim();
  let pass = env.SMTP_PASSWORD_FILE
    ? readFileSync(env.SMTP_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '')
    : env.SMTP_PASSWORD;
  // Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are only
  // for reading and SMTP login fails with them.
  if (pass && GROUPED_APP_PASSWORD_HOSTS.has(host))
    pass = pass.replace(/\s+/g, '');

  return {
    host,
    port,
    secure,
    // Never fall back to plaintext once credentials are involved.
    requireTLS: !secure && !!user && !isTrue(env.SMTP_ALLOW_INSECURE ?? ''),
    ...(user ? { auth: { user, pass: pass ?? '' } } : {}),
  };
}

/**
 * The From address. Gmail and Outlook rewrite (or reject) a From that is not
 * the signed-in account or a verified alias, so default to the SMTP user.
 */
export function mailFrom(env: Env = process.env): string {
  if (env.MAIL_FROM) return env.MAIL_FROM;
  if (env.SMTP_USER?.includes('@'))
    return `GradeBook <${env.SMTP_USER.trim()}>`;
  return 'GradeBook <no-reply@localhost>';
}

function isTrue(v: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}
