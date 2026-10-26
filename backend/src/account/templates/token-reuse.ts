import { accountEmailHtml, formatWhen } from './layout';

export interface ReuseDetails {
  /** The device the session was signed in on. */
  device: string;
  /** The address the old token came back from. */
  ip: string | null;
  at: Date;
  devicesUrl: string;
}

/**
 * Sent when a session is ended because an old copy of its token was used
 * (the token rotates daily; a replaced one showing up again means it was
 * copied). Kept in code so it ships with the build on every host.
 */
export function tokenReuseEmail(d: ReuseDetails): { subject: string; text: string; html: string } {
  const when = formatWhen(d.at);
  const details: [string, string][] = [
    ['Device', d.device],
    ['When', when],
    ...(d.ip ? ([['IP address', d.ip]] as [string, string][]) : []),
  ];
  return {
    subject: 'Suspicious activity: a GradeBook device was signed out',
    text: [
      'We signed one of your devices out of GradeBook because an old copy of its sign-in was used. This can mean someone copied it.',
      '',
      ...details.map(([k, v]) => `${k}: ${v}`),
      '',
      'Sign in again on that device. Review your other signed-in devices and sign out any you do not recognise:',
      d.devicesUrl,
    ].join('\n'),
    html: accountEmailHtml({
      title: 'A GradeBook device was signed out',
      preheader: `We signed ${d.device} out of GradeBook`,
      heading: 'We signed a device out',
      paragraphs: [
        'One of your devices was signed out of GradeBook because an old copy of its sign-in was used. This can mean someone copied it.',
        'Sign in again on that device, and check your other signed-in devices.',
      ],
      details,
      button: { label: 'Review signed-in devices', href: d.devicesUrl },
      footer: 'Sign out any device you do not recognise. GradeBook will never ask you for your sign-in code.',
    }),
  };
}
