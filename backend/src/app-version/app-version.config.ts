/**
 * Which mobile app versions the API still serves, from the environment.
 *
 * MOBILE_MIN_VERSION / MOBILE_LATEST_VERSION apply to both platforms;
 * MOBILE_{MIN,LATEST}_VERSION_{IOS,ANDROID} override one. Store URLs come from
 * MOBILE_IOS_STORE_URL and MOBILE_ANDROID_STORE_URL. Anything unset is null:
 * no minimum means no build is refused.
 */

export type MobilePlatform = 'ios' | 'android';
export const MOBILE_PLATFORMS: readonly MobilePlatform[] = ['ios', 'android'];

export interface PlatformVersionInfo {
  /** Builds below this are refused with 426 and must update. */
  minimum: string | null;
  /** The newest release; builds below it are offered an update. */
  latest: string | null;
  storeUrl: string | null;
}

export type AppVersionConfig = Record<MobilePlatform, PlatformVersionInfo>;

/**
 * MAJOR[.MINOR[.PATCH]] with an optional pre-release / build suffix, which is
 * ignored when comparing. iOS short versions are often just "1.4".
 */
const VERSION_RE = /^(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+][0-9A-Za-z.-]{1,64})?$/;

/** [major, minor, patch], or null when the string is not a version. */
export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const m = VERSION_RE.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Negative when a < b, 0 when equal, positive when a > b. Both must parse. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

type Env = Record<string, string | undefined>;

/**
 * Reads and checks the settings. A malformed value stops a production boot
 * (fail closed: a typo must not silently drop the minimum); in development it
 * is warned about and treated as unset.
 */
export function loadAppVersionConfig(
  env: Env = process.env,
  warn: (message: string) => void = console.warn,
): AppVersionConfig {
  const production = env.NODE_ENV === 'production';
  const bad = (message: string): null => {
    if (production) throw new Error(message);
    warn(`${message}; ignoring it`);
    return null;
  };

  const version = (key: string): string | null => {
    const raw = env[key]?.trim();
    if (!raw) return null;
    return parseVersion(raw)
      ? raw
      : bad(`${key} "${raw}" is not a version (expected e.g. 1.4.0)`);
  };

  const storeUrl = (key: string): string | null => {
    const raw = env[key]?.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:') return url.toString();
    } catch {
      /* falls through */
    }
    return bad(`${key} "${raw}" is not an https URL`);
  };

  const config = {} as AppVersionConfig;
  for (const platform of MOBILE_PLATFORMS) {
    const suffix = platform.toUpperCase();
    const minimum =
      version(`MOBILE_MIN_VERSION_${suffix}`) ?? version('MOBILE_MIN_VERSION');
    let latest =
      version(`MOBILE_LATEST_VERSION_${suffix}`) ??
      version('MOBILE_LATEST_VERSION');
    if (minimum && latest && compareVersions(latest, minimum) < 0) {
      warn(
        `${platform}: latest version ${latest} is below the minimum ${minimum}; using ${minimum} as latest`,
      );
      latest = minimum;
    }
    config[platform] = {
      minimum,
      latest: latest ?? minimum,
      storeUrl: storeUrl(`MOBILE_${suffix}_STORE_URL`),
    };
  }
  return config;
}

/** The app's version header: "ios/1.4.0", "android/1.4.0" or bare "1.4.0". */
export const APP_VERSION_HEADER = 'x-gradebook-app-version';

export interface ClientVersion {
  platform: MobilePlatform | null;
  version: string;
}

/** The parsed header, or null when it is missing or not understood. */
export function parseClientVersion(header: unknown): ClientVersion | null {
  if (typeof header !== 'string' || header.length > 64) return null;
  const slash = header.indexOf('/');
  const platform = slash === -1 ? null : header.slice(0, slash).trim().toLowerCase();
  const version = (slash === -1 ? header : header.slice(slash + 1)).trim();
  if (!parseVersion(version)) return null;
  if (platform === null) return { platform: null, version };
  return (MOBILE_PLATFORMS as readonly string[]).includes(platform)
    ? { platform: platform as MobilePlatform, version }
    : null;
}
