/**
 * Friendly device labels for sessions ("Chrome on macOS", "GradeBook app on
 * iPhone 15 (iOS 19.0)"), shown in Signed-in devices and used to tell a
 * sign-in from a new device apart from a known one.
 *
 * No user-agent library: the handful of browsers and systems people actually
 * use are matched below, and anything else falls back to the product name.
 */

/**
 * Sent by the mobile app: the device model and OS, e.g. "iPhone 15 · iOS 19.0",
 * percent-encoded.
 */
export const DEVICE_HEADER = 'x-gradebook-device';

const MAX_LABEL = 80;

/** Printable characters only, collapsed whitespace, bounded length. */
function clean(value: string, max = MAX_LABEL): string {
  return value
    .replace(/[^\p{L}\p{N}\p{P}\p{Zs}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function browserOf(ua: string): string | null {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/\b(OPR|Opera)\//.test(ua)) return 'Opera';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\b(Firefox|FxiOS)\//.test(ua)) return 'Firefox';
  if (/\b(Chrome|CriOS|Chromium)\//.test(ua)) return 'Chrome';
  if (/\bVersion\/[\d.]+.*Safari\//.test(ua) || /\bMobile\/\w+ Safari/.test(ua)) return 'Safari';
  return null;
}

function osOf(ua: string): string | null {
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bDarwin\b|\bCFNetwork\b/.test(ua)) return 'iOS';
  if (/\bokhttp\b/i.test(ua)) return 'Android';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return null;
}

/** The app percent-encodes the header (values must be ASCII); plain text works too. */
function decodeHeader(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The label for a session.
 *
 * @param userAgent the request's User-Agent header
 * @param device    the app's `X-GradeBook-Device` header, if any
 * @param native    whether the request came from the mobile app
 *                  (`X-GradeBook-Client: native`)
 */
export function deviceLabel(
  userAgent: string | null | undefined,
  device?: string | null,
  native = false,
): string {
  const ua = userAgent ?? '';
  const model = device ? clean(decodeHeader(device), 60) : '';
  // "iPhone 15 · iOS 19.0" -> "iPhone 15 (iOS 19.0)".
  const parts = model.split(/\s*·\s*/).filter(Boolean);
  const named = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0];

  if (native || model || /\bGradeBook\//.test(ua)) {
    const where = named || osOf(ua);
    return where ? `GradeBook app on ${where}` : 'GradeBook app';
  }

  const browser = browserOf(ua);
  const os = osOf(ua);
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Browser on ${os}`;
  // curl/8.4.0, PostmanRuntime/7.36 -> "curl", "PostmanRuntime".
  const product = /^([A-Za-z][\w.-]{0,39})\//.exec(ua.trim());
  return product ? clean(product[1]) : 'Unknown device';
}
