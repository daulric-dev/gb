/**
 * The shared frame of the account emails: the same table-based, inline-styled
 * card as `sign-in-code.ts`, with a heading, paragraphs, an optional details
 * table and button, and a footer line.
 */

/** Escape a value for an HTML text node or attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface AccountEmail {
  title: string;
  preheader: string;
  heading: string;
  /** Plain-text paragraphs (escaped here). */
  paragraphs: string[];
  details?: [label: string, value: string][];
  button?: { label: string; href: string };
  footer: string;
}

export function accountEmailHtml(email: AccountEmail): string {
  const e = escapeHtml;
  const paragraphs = email.paragraphs
    .map(
      (p) =>
        `<p style="margin: 0 0 16px 0; font-size: 14px; line-height: 20px; color: #525252;">${e(p)}</p>`,
    )
    .join('\n                ');
  const details = email.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 24px 0; background-color: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 12px;">
                  ${email.details
                    .map(
                      ([label, value]) => `<tr>
                    <td style="padding: 10px 16px; font-size: 13px; color: #737373; width: 90px; vertical-align: top;">${e(label)}</td>
                    <td style="padding: 10px 16px; font-size: 13px; color: #0a0a0a; font-weight: 600;">${e(value)}</td>
                  </tr>`,
                    )
                    .join('\n                  ')}
                </table>`
    : '';
  const button = email.button
    ? `<a href="${e(email.button.href)}" style="display: inline-block; background-color: #0a0a0a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 20px; border-radius: 10px;">${e(email.button.label)}</a>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>${e(email.title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f5f5f5;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
      ${e(email.preheader)}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 460px; background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 16px;">
            <tr>
              <td style="padding: 40px; font-family: ${FONT};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-left: 12px;">
                      <div style="font-size: 18px; font-weight: 700; color: #0a0a0a;">GradeBook</div>
                      <div style="font-size: 11px; color: #a3a3a3;">by daulric.dev</div>
                    </td>
                  </tr>
                </table>

                <h1 style="margin: 28px 0 12px 0; font-size: 22px; font-weight: 700; color: #0a0a0a;">${e(email.heading)}</h1>
                ${paragraphs}
                ${details}
                ${button}
              </td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 460px;">
            <tr>
              <td style="padding: 20px 40px; text-align: center; font-family: ${FONT}; font-size: 12px; line-height: 18px; color: #a3a3a3;">
                ${e(email.footer)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

/** "26 October 2026, 14:05 UTC" - no time zone of the reader is known. */
export function formatWhen(at: Date): string {
  return `${at.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} UTC`;
}
