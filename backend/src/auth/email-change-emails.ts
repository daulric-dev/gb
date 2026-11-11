import { accountEmailHtml } from '@/account/templates/layout';

type Email = { kind: string; subject: string; text: string; html: string };

/** To the NEW address: the code that proves the person can read it. */
export function emailChangeCodeEmail(code: string, minutes: number): Email {
  const subject = 'Confirm your new GradeBook email address';
  const what =
    'Someone signed in to a GradeBook account asked to use this address for it. ' +
    `Enter this 8-digit code in GradeBook to confirm. It expires in ${minutes} minutes.`;
  const footer = "If this wasn't you, ignore this email: nothing changes without the code.";
  return {
    kind: 'email_change_code',
    subject,
    text: `${what}\n\nYour code is ${code}.\n\n${footer}`,
    html: accountEmailHtml({
      title: subject,
      preheader: `Your code is ${code}`,
      heading: 'Confirm your new email address',
      paragraphs: [what],
      details: [['Code', code]],
      footer,
    }),
  };
}

/** To the OLD address once the change is made: a security alert. */
export function emailChangedAlertEmail(maskedNew: string, when: Date): Email {
  const subject = 'Your GradeBook email address was changed';
  const what =
    `The email address of your GradeBook account was changed to ${maskedNew} on ${when.toUTCString()}. ` +
    'You now sign in with the new address, and your other devices were signed out.';
  const footer =
    "If this wasn't you, contact your school's GradeBook administrator straight away: someone may have used your account.";
  return {
    kind: 'email_changed_alert',
    subject,
    text: `${what}\n\n${footer}`,
    html: accountEmailHtml({
      title: subject,
      preheader: 'Your sign-in address was changed',
      heading: 'Your email address was changed',
      paragraphs: [what],
      details: [['New address', maskedNew]],
      footer,
    }),
  };
}
