import { SMTP_PRESETS } from '@/mail/mail.config';

/**
 * The recipients and sub-processors section of the privacy notice, built
 * from the install's live configuration, so it changes when the
 * configuration does. Pure: `PrivacyService` gathers the inputs.
 *
 * Hosts on a private network (a self-hosted LibreTranslate, an internal
 * webhook receiver) are listed as "on the organisation's own network"
 * without the address: the notice is public and need not map internal
 * systems.
 */

export type RecipientCategory =
  | 'hosting'
  | 'email'
  | 'storage'
  | 'backup'
  | 'push'
  | 'sso'
  | 'ai'
  | 'translation'
  | 'webhook'
  | 'lti'
  | 'rostering';

export interface Recipient {
  category: RecipientCategory;
  /** Who it is: a known provider name, or the host when unknown. */
  name: string;
  /** The host data is sent to; null when internal or not applicable. */
  host: string | null;
  /** True when the host is on the organisation's own network. */
  internal: boolean;
  /** What is sent and why, in plain words. */
  purpose: string;
  /** Where it is, when known (a region, or what the organisation entered). */
  location: string | null;
}

export interface AdditionalRecipient {
  name: string;
  purpose: string;
  location?: string | null;
}

export interface RecipientSources {
  env: Record<string, string | undefined>;
  /** The organisation's own feature switches. */
  features: Record<string, boolean>;
  aiProviders: { name: string; kind: string; baseUrl: string | null }[];
  translation: { engine: string; url: string | null; enabled: boolean } | null;
  /** URLs of enabled webhooks, any school. */
  webhookUrls: string[];
  /** Enabled LTI tools. */
  ltiTools: { name: string; loginUrl: string; targetLinkUri: string; sendName: boolean; sendEmail: boolean }[];
  /** Roster sources that call an API (CSV uploads have no recipient). */
  rosterSources: { name: string; kind: string; baseUrl: string | null }[];
  /** Enabled school sign-in apps: google | azure | oidc (+ issuer). */
  schoolSsoProviders: { provider: string; issuer: string | null }[];
  /** SAML entry points of email domains that sign in with SAML. */
  samlEntryPoints: string[];
  additional: AdditionalRecipient[];
}

/** Host suffixes of well-known providers, most specific first. */
const KNOWN_PROVIDERS: readonly [string, string][] = [
  ['email-smtp.', 'Amazon Web Services (Amazon SES)'],
  ['r2.cloudflarestorage.com', 'Cloudflare (R2)'],
  ['amazonaws.com', 'Amazon Web Services'],
  ['backblazeb2.com', 'Backblaze (B2)'],
  ['digitaloceanspaces.com', 'DigitalOcean (Spaces)'],
  ['wasabisys.com', 'Wasabi'],
  ['scw.cloud', 'Scaleway'],
  ['cloud.ovh.net', 'OVHcloud'],
  ['io.cloud.ovh.net', 'OVHcloud'],
  ['your-objectstorage.com', 'Hetzner'],
  ['storage.googleapis.com', 'Google Cloud Storage'],
  ['blob.core.windows.net', 'Microsoft Azure'],
  ['smtp.gmail.com', 'Google (Gmail / Google Workspace)'],
  ['smtp.office365.com', 'Microsoft (Exchange Online)'],
  ['smtp.mail.yahoo.com', 'Yahoo'],
  ['smtp.mail.me.com', 'Apple (iCloud Mail)'],
  ['smtp.zoho.com', 'Zoho'],
  ['zoho.eu', 'Zoho'],
  ['sendgrid.net', 'Twilio SendGrid'],
  ['mailgun.org', 'Mailgun'],
  ['postmarkapp.com', 'Postmark'],
  ['brevo.com', 'Brevo'],
  ['sendinblue.com', 'Brevo'],
  ['mailjet.com', 'Mailjet'],
  ['sparkpostmail.com', 'SparkPost'],
  ['resend.com', 'Resend'],
  ['api.anthropic.com', 'Anthropic'],
  ['api.openai.com', 'OpenAI'],
  ['openai.azure.com', 'Microsoft Azure OpenAI'],
  ['api.mistral.ai', 'Mistral AI'],
  ['generativelanguage.googleapis.com', 'Google (Gemini API)'],
  ['openrouter.ai', 'OpenRouter'],
  ['api.groq.com', 'Groq'],
  ['api.deepl.com', 'DeepL'],
  ['api-free.deepl.com', 'DeepL'],
  ['translate.googleapis.com', 'Google (Translate)'],
  ['translate.yandex.net', 'Yandex'],
  ['accounts.google.com', 'Google'],
  ['login.microsoftonline.com', 'Microsoft (Entra ID)'],
  ['exp.host', 'Expo'],
];

/** The provider's name for a host, or null. */
export function providerName(host: string): string | null {
  const h = host.toLowerCase();
  for (const [suffix, name] of KNOWN_PROVIDERS) {
    if (suffix.endsWith('.') ? h.startsWith(suffix) : h === suffix || h.endsWith(`.${suffix}`)) {
      return name;
    }
  }
  return null;
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Whether a hostname is on a private network: a private IP, localhost or an internal name. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isPrivateIPv4(h)) return true;
  if (h.includes(':')) {
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }
  if (!h.includes('.')) return true; // a single-label name: compose service, intranet host
  return ['.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'].some((s) => h.endsWith(s));
}

/** The hostname of a URL (or bare host), or null when it is not one. */
export function hostOf(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function recipient(
  category: RecipientCategory,
  rawUrl: string | null,
  purpose: string,
  opts: { name?: string; location?: string | null } = {},
): Recipient | null {
  const host = hostOf(rawUrl);
  if (rawUrl && !host) return null;
  const internal = host ? isInternalHost(host) : false;
  const known = host && !internal ? providerName(host) : null;
  const name =
    opts.name ??
    (internal ? "The organisation's own server" : (known ?? host ?? 'Unknown'));
  return {
    category,
    name,
    host: internal ? null : host,
    internal,
    purpose,
    location: opts.location ?? null,
  };
}

/** The SMTP server's host from SMTP_URL, SMTP_HOST or SMTP_SERVICE. */
export function smtpHost(env: Record<string, string | undefined>): string | null {
  if (env.SMTP_URL?.trim()) return hostOf(env.SMTP_URL);
  if (env.SMTP_HOST?.trim()) return hostOf(env.SMTP_HOST);
  const service = env.SMTP_SERVICE?.trim().toLowerCase();
  return service ? (SMTP_PRESETS[service]?.host ?? null) : null;
}

function s3Region(region: string | undefined): string | null {
  const r = region?.trim();
  return r && r !== 'auto' ? r : null;
}

/** An S3 bucket's host: the endpoint, or AWS for the region when none is set. */
function s3Host(endpoint: string | undefined, region: string | undefined): string {
  if (endpoint?.trim()) return endpoint.trim();
  const r = s3Region(region);
  return r ? `s3.${r}.amazonaws.com` : 's3.amazonaws.com';
}

const AI_KIND_DEFAULT_HOST: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
};

const TRANSLATION_HOSTS: Record<string, string> = {
  google: 'https://translate.googleapis.com',
  deepl: 'https://api.deepl.com',
  yandex: 'https://translate.yandex.net',
};

const SSO_HOSTS: Record<string, string> = {
  google: 'https://accounts.google.com',
  azure: 'https://login.microsoftonline.com',
};

const SSO_PURPOSE =
  'Confirms who you are when you sign in with it; receives the sign-in request and returns your name and email address';

/** Every recipient for this configuration, without duplicates, in notice order. */
export function buildRecipients(src: RecipientSources): Recipient[] {
  const env = src.env;
  const out: (Recipient | null)[] = [];

  // Email: sign-in codes, invites, notices.
  const smtp = smtpHost(env);
  if (smtp) {
    out.push(
      recipient('email', smtp, 'Delivers email: sign-in codes, invitations, alerts and notices (recipient address, subject and message)'),
    );
  }

  // File storage (the app bucket) and an avatar CDN in front of it.
  if (env.S3_ENDPOINT?.trim() || env.S3_ACCESS_KEY_ID?.trim() || env.S3_BUCKET?.trim()) {
    out.push(
      recipient('storage', s3Host(env.S3_ENDPOINT, env.S3_REGION), 'Stores uploaded files, submissions, profile pictures, report PDFs and exports', {
        location: s3Region(env.S3_REGION),
      }),
    );
  }
  if (env.S3_PUBLIC_URL?.trim()) {
    out.push(recipient('storage', env.S3_PUBLIC_URL, 'Serves profile pictures and school logos to browsers'));
  }

  // Backups (the backup service reads the same .env file).
  if (env.BACKUP_S3_BUCKET?.trim()) {
    out.push(
      recipient('backup', s3Host(env.BACKUP_S3_ENDPOINT, env.BACKUP_S3_REGION), 'Stores encrypted database backups (the provider cannot read them)', {
        location: s3Region(env.BACKUP_S3_REGION),
      }),
    );
  }
  if (env.WALG_S3_PREFIX?.trim()) {
    out.push(
      recipient('backup', s3Host(env.WALG_S3_ENDPOINT, env.WALG_S3_REGION), 'Stores encrypted continuous database backups (the provider cannot read them)', {
        location: s3Region(env.WALG_S3_REGION),
      }),
    );
  }

  // Push notifications to the mobile app.
  if (src.features.push_notifications) {
    const purpose =
      'Delivers mobile push notifications: the device token and the notification text (only a generic text where the school chose generic notifications)';
    out.push(recipient('push', 'https://exp.host', purpose, { name: 'Expo' }));
    out.push(recipient('push', 'https://api.push.apple.com', purpose, { name: 'Apple (Push Notification service, iPhone)' }));
    out.push(recipient('push', 'https://fcm.googleapis.com', purpose, { name: 'Google (Firebase Cloud Messaging, Android)' }));
  }

  // Single sign-on.
  const envSso = (env.SSO_PROVIDERS ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  for (const p of envSso) {
    if (SSO_HOSTS[p]) out.push(recipient('sso', SSO_HOSTS[p], SSO_PURPOSE));
  }
  for (const p of src.schoolSsoProviders) {
    if (SSO_HOSTS[p.provider]) out.push(recipient('sso', SSO_HOSTS[p.provider], SSO_PURPOSE));
    else if (p.provider === 'oidc' && p.issuer) out.push(recipient('sso', p.issuer, SSO_PURPOSE));
  }
  for (const entry of src.samlEntryPoints) {
    out.push(recipient('sso', entry, `${SSO_PURPOSE} (SAML)`));
  }

  // AI assistance.
  if (src.features.ai_assistance) {
    for (const p of src.aiProviders) {
      const url = p.baseUrl ?? AI_KIND_DEFAULT_HOST[p.kind] ?? null;
      if (!url) continue;
      out.push(
        recipient('ai', url, 'Generates drafts and suggestions for staff. Names and contact details are removed first; student work is sent only where the school allowed it', {
          name: providerName(hostOf(url) ?? '') ?? undefined,
        }),
      );
    }
  }

  // Translation.
  if (src.features.translation && src.translation?.enabled) {
    const url = src.translation.engine === 'libre' ? src.translation.url : TRANSLATION_HOSTS[src.translation.engine];
    if (url) {
      out.push(
        recipient('translation', url, 'Translates interface text and course content into the language a person chose; never names, grades, feedback, messages or notes', {
          name: src.translation.engine === 'libre' ? undefined : providerName(hostOf(url) ?? '') ?? undefined,
        }),
      );
    }
  }

  // Integrations the schools set up.
  if (src.features.integrations) {
    for (const url of src.webhookUrls) {
      out.push(recipient('webhook', url, 'Receives the events a school subscribed its webhook to (for example grade or attendance changes)'));
    }
  }
  if (src.features.lti) {
    for (const t of src.ltiTools) {
      const sends = [
        'a pseudonymous user id',
        'role',
        'course',
        ...(t.sendName ? ['name'] : []),
        ...(t.sendEmail ? ['email address'] : []),
      ];
      out.push(
        recipient('lti', t.loginUrl || t.targetLinkUri, `External tool "${t.name}": receives ${sends.join(', ')} when someone opens it; may send back grades`),
      );
    }
  }
  if (src.features.rostering) {
    for (const s of src.rosterSources) {
      if (s.kind !== 'oneroster_api' || !s.baseUrl) continue;
      out.push(recipient('rostering', s.baseUrl, `Rostering source "${s.name}": sends GradeBook the school's students, staff, classes and enrolments`));
    }
  }

  // What the organisation added by hand (hosting, managed database...).
  for (const a of src.additional) {
    out.push({
      category: 'hosting',
      name: a.name,
      host: null,
      internal: false,
      purpose: a.purpose,
      location: a.location?.trim() || null,
    });
  }

  const seen = new Set<string>();
  const result: Recipient[] = [];
  for (const r of out) {
    if (!r) continue;
    const key = `${r.category}|${r.host ?? ''}|${r.name}|${r.internal ? r.purpose : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}
