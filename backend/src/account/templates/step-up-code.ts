import { accountEmailHtml } from './layout';

/**
 * "Confirm it's you": the code a signed-in admin enters before changing
 * single sign-on settings (step-up). Separate from the sign-in code email so
 * nobody mistakes one for the other - and the codes are not interchangeable.
 */
export function stepUpCodeEmail(code: string): { subject: string; text: string; html: string } {
  const subject = 'Confirm a GradeBook settings change';
  const what =
    'Someone signed in to your GradeBook account asked to change single sign-on or integration settings. ' +
    'Enter this 8-digit code to confirm it is you. It expires in 5 minutes and can only be used once.';
  const footer =
    "If this wasn't you, don't share the code: someone may be using your account. Sign out your other devices from Settings.";
  return {
    subject,
    text: `${what}\n\nYour confirmation code is ${code}.\n\n${footer}`,
    html: accountEmailHtml({
      title: subject,
      preheader: `Your confirmation code is ${code}`,
      heading: "Confirm it's you",
      paragraphs: [what],
      details: [['Code', code]],
      footer,
    }),
  };
}
