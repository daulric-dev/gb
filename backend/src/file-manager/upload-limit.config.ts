/**
 * Platform upload limits, from the environment.
 *
 * UPLOAD_MAX_MB is the ceiling no school can go above; UPLOAD_DEFAULT_MB is
 * what a school gets until it picks its own (`school.max_upload_mb`). Both
 * default to 100, the limit before schools could choose.
 */

export const MB = 1024 * 1024;

/** The database CHECK on `school.max_upload_mb`; the env ceiling sits inside it. */
export const SCHOOL_UPLOAD_MB_RANGE = { min: 1, max: 1024 } as const;
export const DEFAULT_UPLOAD_MAX_MB = 1024;
export const DEFAULT_UPLOAD_DEFAULT_MB = 100;

export interface UploadLimitConfig {
  /** Hard ceiling for every school, in MB. */
  maxMb: number;
  /** What a school without its own setting gets, in MB (never above maxMb). */
  defaultMb: number;
}

type Env = Record<string, string | undefined>;

/**
 * Reads and checks the settings. A malformed value stops a production boot
 * (fail closed: a typo must not silently change every school's limit); in
 * development it is warned about and the default is used.
 */
export function loadUploadLimitConfig(
  env: Env = process.env,
  warn: (message: string) => void = console.warn,
): UploadLimitConfig {
  const production = env.NODE_ENV === 'production';

  const read = (key: string, fallback: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (
      Number.isSafeInteger(value) &&
      value >= SCHOOL_UPLOAD_MB_RANGE.min &&
      value <= SCHOOL_UPLOAD_MB_RANGE.max
    ) {
      return value;
    }
    const message = `${key} "${raw}" is not a whole number of MB between ${SCHOOL_UPLOAD_MB_RANGE.min} and ${SCHOOL_UPLOAD_MB_RANGE.max}`;
    if (production) throw new Error(message);
    warn(`${message}; using ${fallback}`);
    return fallback;
  };

  const maxMb = read('UPLOAD_MAX_MB', DEFAULT_UPLOAD_MAX_MB);
  let defaultMb = read('UPLOAD_DEFAULT_MB', Math.min(DEFAULT_UPLOAD_DEFAULT_MB, maxMb));
  if (defaultMb > maxMb) {
    warn(
      `UPLOAD_DEFAULT_MB ${defaultMb} is above UPLOAD_MAX_MB ${maxMb}; using ${maxMb}`,
    );
    defaultMb = maxMb;
  }
  return { maxMb, defaultMb };
}

/** A school's limit in MB: its own setting or the default, never above the ceiling. */
export function effectiveUploadMb(
  config: UploadLimitConfig,
  schoolMb: number | null | undefined,
): number {
  return Math.min(schoolMb ?? config.defaultMb, config.maxMb);
}
