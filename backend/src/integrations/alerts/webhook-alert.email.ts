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
