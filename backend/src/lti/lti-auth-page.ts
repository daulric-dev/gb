import { randomBytes } from 'node:crypto';

/**
 * The pages the OIDC auth endpoint answers with. Served by the API with
 * their own strict CSP, so the web app's CSP is untouched: the only script
 * is the nonce'd auto-submit, and `form-action` allows only the tool's
 * registered redirect origin.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'text/html; charset=utf-8',
};

export interface HtmlPage {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function autoPostPage(action: string, fields: Record<string, string>): HtmlPage {
  const nonce = randomBytes(16).toString('base64');
  const origin = new URL(action).origin;
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Opening the tool…</title></head>' +
    '<body style="font-family:system-ui,sans-serif;margin:2rem">' +
    `<form id="lti" method="post" action="${escapeHtml(action)}">${inputs}` +
    '<p>Opening the tool…</p><noscript><button type="submit">Continue</button></noscript></form>' +
    `<script nonce="${nonce}">document.getElementById('lti').submit();</script>` +
    '</body></html>';
  return {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      'Content-Security-Policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        `form-action ${origin}`,
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
    body,
  };
}

export function errorPage(status: number, message: string): HtmlPage {
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>The tool could not be opened</title></head>' +
    '<body style="font-family:system-ui,sans-serif;margin:2rem">' +
    '<h1 style="font-size:1.25rem">The tool could not be opened</h1>' +
    `<p>${escapeHtml(message)}</p><p>Close this tab and open the tool again from your course.</p>` +
    '</body></html>';
  return {
    status,
    headers: {
      ...COMMON_HEADERS,
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
    body,
  };
}
