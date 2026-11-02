import { accountEmailHtml, formatWhen } from '@/account/templates/layout';

export interface InviteEmailInput {
  kind: 'school_admin' | 'organisation_admin';
  /** The school (school_admin) or the organisation (organisation_admin). */
  place: string;
  /** Who sent it, when known ("Ada Lovelace" or their email). */
  inviter: string | null;
  expiresAt: Date;
  signInUrl: string;
}

/**
 * "You've been invited to run <School> on GradeBook" / "...to administer
 * <Organisation> on GradeBook". Kept in code like src/account/templates, and
 * escaped by the shared layout.
 */
export function inviteEmail(input: InviteEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const role =
    input.kind === 'school_admin'
      ? `run ${input.place}`
      : `administer ${input.place}`;
  const subject = `You've been invited to ${role} on GradeBook`;
  const by = input.inviter ? `${input.inviter} invited you` : 'You have been invited';
  const what =
    input.kind === 'school_admin'
      ? `${by} to be the administrator of ${input.place} on GradeBook.`
      : `${by} to be an organisation administrator of ${input.place} on GradeBook.`;
  const how =
    'Sign in with this email address and you will be set up straight away. ' +
    'There is nothing else to accept.';
  const expires = formatWhen(input.expiresAt);
  const footer =
    "If you weren't expecting this, you can ignore this email; the invite expires on its own.";

  return {
    subject,
    text: [
      what,
      how,
      `Sign in: ${input.signInUrl}`,
      `The invite expires ${expires}.`,
      footer,
    ].join('\n\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: what,
      heading: `You've been invited to ${role}`,
      paragraphs: [what, how],
      details: [
        [input.kind === 'school_admin' ? 'School' : 'Organisation', input.place],
        ['Expires', expires],
      ],
      button: { label: 'Sign in to GradeBook', href: input.signInUrl },
      footer,
    }),
  };
}
