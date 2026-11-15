import { accountEmailHtml, formatWhen } from './layout';

export interface RotationRecoveredDetails {
  /** The device the session was signed in on. */
  device: string;
  /** The address the replaced sign-in came back from. */
  ip: string | null;
  at: Date;
  devicesUrl: string;
}

/**
 * Sent when a replaced sign-in token was accepted again because the rotating
 * response had clearly never reached the client (nothing has used the new
 * token, and the old one came back from the same device).
 *
 * That is almost always a connection that dropped at the wrong moment. But a
 * token copied before the real device's next request looks exactly the same
 * from the server, so the account is told either way and can end the session
 * if it was not them. Kept in code so it ships with the build on every host.
 */
export function rotationRecoveredEmail(
  d: RotationRecoveredDetails,
): { subject: string; text: string; html: string } {
  const when = formatWhen(d.at);
  const details: [string, string][] = [
    ['Device', d.device],
    ['When', when],
    ...(d.ip ? ([['IP address', d.ip]] as [string, string][]) : []),
  ];
  return {
    subject: 'A GradeBook sign-in was recovered',
    text: [
      'A device went on using an earlier GradeBook sign-in after it had been replaced. This usually means the connection dropped while we were replacing it, and the device simply carried on.',
      '',
      ...details.map(([k, v]) => `${k}: ${v}`),
      '',
      'If that was you, there is nothing to do. If it was not, sign that device out here:',
      d.devicesUrl,
    ].join('\n'),
    html: accountEmailHtml({
      title: 'A GradeBook sign-in was recovered',
      preheader: `${d.device} went on using an earlier sign-in`,
      heading: 'A sign-in was recovered',
      paragraphs: [
        'A device went on using an earlier GradeBook sign-in after it had been replaced. This usually means the connection dropped while we were replacing it, and the device simply carried on.',
        'If that was you, there is nothing to do. If it was not, sign that device out.',
      ],
      details,
      button: { label: 'Review signed-in devices', href: d.devicesUrl },
      footer: 'Sign out any device you do not recognise. GradeBook will never ask you for your sign-in code.',
    }),
  };
}
