import { accountEmailHtml, formatWhen } from '@/account/templates/layout';
import type { FieldChange, SsoActorVia, SsoAuditEntry } from './sso-audit.service';

export interface SsoChangedEmailInput {
  school: string;
  /** "Ada Lovelace (ada@riverside.edu)", or null for the system. */
  actor: string | null;
  via: SsoActorVia;
  at: Date;
  entries: SsoAuditEntry[];
  settingsUrl: string;
}

/** Field names as the settings page labels them. */
const FIELD_LABEL: Record<string, string> = {
  ssoProvider: 'Sign-in provider',
  ssoRequired: 'Require single sign-on',
  azureTenantId: 'Microsoft tenant ID',
  samlEntryPoint: 'SAML sign-on URL',
  samlIssuer: 'SAML entity ID',
  samlCertificate: 'SAML signing certificate (SHA-256)',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  enabled: 'Turned on',
  settings: 'Settings',
};

const APP_LABEL: Record<string, string> = { google: 'Google', azure: 'Microsoft' };

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(none)';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isChange(value: unknown): value is FieldChange {
  return !!value && typeof value === 'object' && 'before' in value && 'after' in value;
}

/**
 * One line per entry: what it was about (a domain, or a sign-in app) and
 * each field's before and after. Entries never carry a secret (see
 * SsoAuditService), so everything here is safe to mail.
 */
export function describeEntry(entry: SsoAuditEntry): [label: string, value: string] {
  const app = typeof entry.changes.app === 'string' ? entry.changes.app : null;
  const subject = entry.domain ?? (app ? `${APP_LABEL[app] ?? app} sign-in app` : 'School');
  const fields = Object.entries(entry.changes)
    .filter(([, v]) => isChange(v))
    .map(([k, v]) => {
      const c = v as FieldChange;
      return `${FIELD_LABEL[k] ?? k}: ${show(c.before)} → ${show(c.after)}`;
    });
  return [subject, fields.length ? fields.join('; ') : entry.action.replace(/_/g, ' ')];
}

/**
 * "Single sign-on settings changed for <School>": who, when, what (field
 * names and values, certificate fingerprints - never secrets) and a link to
 * the school's settings. Escaped by the shared layout.
 */
export function ssoChangedEmail(input: SsoChangedEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Single sign-on settings changed for ${input.school}`;
  const who = input.actor ?? 'GradeBook';
  const place = input.via === 'organisation_admin' ? 'the organisation console' : 'school settings';
  const when = formatWhen(input.at);
  const intro = `${who} changed how people sign in to ${input.school}, from ${place}.`;
  const warn =
    'Whoever controls a domain\'s sign-in provider can sign in as anyone on that domain. ' +
    'If you did not expect this change, review the settings now.';
  const lines = input.entries.map(describeEntry);
  const footer =
    "You are getting this because you administer this school or its organisation on GradeBook.";

  return {
    subject,
    text: [
      intro,
      `When: ${when}`,
      ...lines.map(([label, value]) => `${label}: ${value}`),
      warn,
      `Review: ${input.settingsUrl}`,
      footer,
    ].join('\n\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: intro,
      heading: 'Single sign-on settings changed',
      paragraphs: [intro, warn],
      details: [['When', when], ['By', who], ...lines],
      button: { label: 'Review sign-in settings', href: input.settingsUrl },
      footer,
    }),
  };
}
