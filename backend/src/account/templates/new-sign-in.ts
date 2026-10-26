import { accountEmailHtml, formatWhen } from './layout';

export interface SignInDetails {
  /** Friendly device label, e.g. "Chrome on macOS". */
  device: string;
  /** The address the request came from; no location lookup is done. */
  ip: string | null;
  at: Date;
  /** Signed-in devices on the web account page. */
  devicesUrl: string;
}

/**
 * "New sign-in to GradeBook": sent when an account signs in from a device it
 * has not used recently. Kept in code so it ships with the build on every host.
 */
export function newSignInEmail(d: SignInDetails): { subject: string; text: string; html: string } {
  const when = formatWhen(d.at);
  const details: [string, string][] = [
    ['Device', d.device],
    ['When', when],
    ...(d.ip ? ([['IP address', d.ip]] as [string, string][]) : []),
  ];
  return {
    subject: 'New sign-in to GradeBook',
    text: [
      'Your GradeBook account was just signed in to from a new device.',
      '',
      ...details.map(([k, v]) => `${k}: ${v}`),
      '',
      'If this was you, there is nothing to do.',
      `If it wasn't, sign that device out and sign in again: ${d.devicesUrl}`,
    ].join('\n'),
    html: accountEmailHtml({
      title: 'New sign-in to GradeBook',
      preheader: `New sign-in from ${d.device}`,
      heading: 'New sign-in to your account',
      paragraphs: ['Your GradeBook account was just signed in to from a new device.'],
      details,
      button: { label: 'Review signed-in devices', href: d.devicesUrl },
      footer:
        "If this was you, you can ignore this email. If it wasn't, sign that device out from Signed-in devices.",
    }),
  };
}
