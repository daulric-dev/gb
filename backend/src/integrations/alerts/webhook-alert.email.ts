import { accountEmailHtml, formatWhen } from '@/account/templates/layout';

export interface WebhookDisabledEmailInput {
  school: string;
  webhook: string;
  failures: number;
  at: Date;
  settingsUrl: string;
}

/**
 * "A webhook was switched off for <School>": which one, after how many
 * failures, and a link to its settings. Never the URL's secret parts or the
 * signing secret. Escaped by the shared layout.
 */
export interface WebhookTlsDisabledEmailInput {
  school: string;
  webhook: string;
  at: Date;
  settingsUrl: string;
}

/**
 * "TLS verification turned off for webhook X": sent when an admin switches
 * certificate checks off, since deliveries can then be intercepted.
 */
export function webhookTlsDisabledEmail(input: WebhookTlsDisabledEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `TLS verification turned off for webhook "${input.webhook}" - deliveries can be intercepted`;
  const when = formatWhen(input.at);
  const intro =
    `Certificate (SSL/TLS) verification was turned off for the webhook "${input.webhook}" of ${input.school}. ` +
    'Its deliveries can now be read or changed by anyone between GradeBook and the receiving server.';
  const next =
    'If this was not you, or it was only for a test, turn "Verify SSL/TLS certificate" back on. ' +
    "If the receiver uses a self-signed or private-CA certificate, add that CA as the webhook's trusted CA certificate instead.";
  const footer =
    'You are getting this because you administer this school or its organisation on GradeBook.';
  return {
    subject,
    text: [intro, `When: ${when}`, next, `Review: ${input.settingsUrl}`, footer].join('\n\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: intro,
      heading: 'TLS verification turned off',
      paragraphs: [intro, next],
      details: [
        ['Webhook', input.webhook],
        ['School', input.school],
        ['When', when],
      ],
      button: { label: 'Review integrations', href: input.settingsUrl },
      footer,
    }),
  };
}

export function webhookDisabledEmail(input: WebhookDisabledEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Webhook "${input.webhook}" was switched off for ${input.school}`;
  const when = formatWhen(input.at);
  const intro =
    `GradeBook switched off the webhook "${input.webhook}" after ${input.failures} failed deliveries in a row. ` +
    'Events are no longer being sent to it.';
  const next =
    'Check that the receiving system is up and answers with a 2xx status, then switch the webhook back on. ' +
    'Deliveries that were given up on can be sent again from its delivery list.';
  const footer =
    'You are getting this because you administer this school or its organisation on GradeBook.';
  return {
    subject,
    text: [intro, `When: ${when}`, next, `Review: ${input.settingsUrl}`, footer].join('\n\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: intro,
      heading: 'Webhook switched off',
      paragraphs: [intro, next],
      details: [
        ['Webhook', input.webhook],
        ['School', input.school],
        ['When', when],
      ],
      button: { label: 'Review integrations', href: input.settingsUrl },
      footer,
    }),
  };
}
