import { accountEmailHtml } from '@/account/templates/layout';

export interface OwnershipEmailInput {
  /** What changed hands. */
  kind: 'organisation' | 'school';
  /** The organisation's or the school's name. */
  place: string;
  /** Who receives this email: the new owner, or the one who handed over. */
  recipient: 'new_owner' | 'previous_owner';
  /** The other party's display name or email. */
  other: string;
  /** Who made the change ("Ada Lovelace" or their email). */
  by: string;
  settingsUrl: string;
}

/**
 * "You now own <Place> on GradeBook" / "You handed <Place> over". Sent to
 * both parties after a transfer (src/organisation/ownership.service.ts),
 * escaped by the shared account email layout.
 */
export function ownershipEmail(input: OwnershipEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const what = input.kind === 'organisation' ? 'the organisation' : 'the school';
  const subject =
    input.recipient === 'new_owner'
      ? `You now own ${input.place} on GradeBook`
      : `${input.place} has a new owner on GradeBook`;
  const lead =
    input.recipient === 'new_owner'
      ? `${input.by} made you the owner of ${what} ${input.place}.`
      : `Ownership of ${what} ${input.place} was transferred to ${input.other} by ${input.by}.`;
  const detail =
    input.recipient === 'new_owner'
      ? input.kind === 'organisation'
        ? 'As owner you are the person who can hand it on again. You stay an organisation administrator as before.'
        : 'As owner you are its administrator and the person who can hand it on again.'
      : input.kind === 'organisation'
        ? 'You are still an organisation administrator, and you can now leave or delete your account.'
        : 'You are still a member of the school (as a teacher), and you can now leave it or delete your account.';
  const footer =
    "If you didn't expect this, contact your organisation's administrators straight away.";
  return {
    subject,
    text: [lead, detail, `Settings: ${input.settingsUrl}`, footer].join('\n\n'),
    html: accountEmailHtml({
      title: subject,
      preheader: lead,
      heading: subject,
      paragraphs: [lead, detail],
      details: [
        [input.kind === 'organisation' ? 'Organisation' : 'School', input.place],
        ['Changed by', input.by],
      ],
      button: { label: 'Open GradeBook', href: input.settingsUrl },
      footer,
    }),
  };
}
