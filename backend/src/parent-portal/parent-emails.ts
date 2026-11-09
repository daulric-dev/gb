import { accountEmailHtml } from '@/account/templates/layout';
import { formatDueDate } from '@/grading/due-date';

type Email = { subject: string; text: string; html: string };

/** "<School> invited you to follow <child> on GradeBook". */
export function parentInviteEmail(d: {
  schoolName: string;
  childName: string;
  acceptUrl: string;
  expiresAt: Date;
}): Email {
  const subject = `${d.schoolName} invited you to the GradeBook parent portal`;
  const lines = [
    `${d.schoolName} invited you to follow ${d.childName}'s grades, work and attendance on GradeBook.`,
    'Open the link below and sign in with this email address. You will get a sign-in code by email; there is no password.',
  ];
  return {
    subject,
    text: [
      ...lines,
      '',
      d.acceptUrl,
      '',
      `The link works once and expires on ${formatDueDate(d.expiresAt)}.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join('\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: `Follow ${d.childName} on GradeBook`,
      heading: 'You are invited to the parent portal',
      paragraphs: lines,
      details: [
        ['School', d.schoolName],
        ['Child', d.childName],
      ],
      button: { label: 'Accept the invitation', href: d.acceptUrl },
      footer: `The link works once and expires on ${formatDueDate(d.expiresAt)}. If you weren't expecting this, you can ignore this email.`,
    }),
  };
}

/** One parent notice (missing work, absence, new grade, announcement). */
export function parentNoticeEmail(d: {
  title: string;
  body: string;
  childName: string;
  url: string;
}): Email {
  return {
    subject: d.title,
    text: [
      d.body,
      '',
      d.url,
      '',
      'You get these because you turned on email notices in the GradeBook parent portal. Turn them off in Settings there.',
    ].join('\n'),
    html: accountEmailHtml({
      title: d.title,
      preheader: d.body,
      heading: d.title,
      paragraphs: [d.body],
      details: [['Child', d.childName]],
      button: { label: 'Open the parent portal', href: d.url },
      footer:
        'You get these because you turned on email notices in the GradeBook parent portal. Turn them off in Settings there.',
    }),
  };
}
