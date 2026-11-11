import { accountEmailHtml, formatWhen } from '@/account/templates/layout';

type Email = { subject: string; text: string; html: string };

interface Base {
  at: Date;
  /** Account settings on the web, where two-step verification is managed. */
  settingsUrl: string;
}

function build(
  subject: string,
  heading: string,
  lines: string[],
  details: [string, string][],
  footer: string,
  settingsUrl: string,
): Email {
  return {
    subject,
    text: [...lines, '', ...details.map(([k, v]) => `${k}: ${v}`), '', footer, settingsUrl].join('\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: lines[0],
      heading,
      paragraphs: lines,
      details,
      button: { label: 'Review your account', href: settingsUrl },
      footer,
    }),
  };
}

/** A recovery code was used to sign in. */
export function recoveryCodeUsedEmail(
  d: Base & { device: string; ip: string | null; remaining: number },
): Email {
  return build(
    'A recovery code was used to sign in to GradeBook',
    'Recovery code used',
    [
      'Someone signed in to your GradeBook account with one of your recovery codes instead of your authenticator app.',
      `You have ${d.remaining} unused recovery code${d.remaining === 1 ? '' : 's'} left.`,
    ],
    [
      ['Device', d.device],
      ['When', formatWhen(d.at)],
      ...(d.ip ? ([['IP address', d.ip]] as [string, string][]) : []),
    ],
    "If this wasn't you, sign that device out, then set up your authenticator app again and make new recovery codes:",
    d.settingsUrl,
  );
}

/** An organisation admin removed the user's authenticator app. */
export function mfaResetEmail(d: Base & { by: string }): Email {
  return build(
    'Your GradeBook two-step verification was reset',
    'Two-step verification reset',
    [
      `${d.by} removed the authenticator app and recovery codes from your GradeBook account.`,
      'You can sign in with an emailed code again. Set up an authenticator app again from your account settings.',
    ],
    [['When', formatWhen(d.at)]],
    "If you didn't ask for this, tell your organisation's administrator:",
    d.settingsUrl,
  );
}

/** Two-step verification was turned on or off by the user. */
export function mfaChangedEmail(d: Base & { enabled: boolean }): Email {
  return build(
    d.enabled
      ? 'Two-step verification is on for your GradeBook account'
      : 'Two-step verification is off for your GradeBook account',
    d.enabled ? 'Authenticator app added' : 'Authenticator app removed',
    [
      d.enabled
        ? 'An authenticator app was set up on your GradeBook account. Signing in now needs a code from it after the emailed code.'
        : 'The authenticator app was removed from your GradeBook account. Signing in needs only the emailed code.',
    ],
    [['When', formatWhen(d.at)]],
    "If this wasn't you, sign out your other devices and review your account:",
    d.settingsUrl,
  );
}
