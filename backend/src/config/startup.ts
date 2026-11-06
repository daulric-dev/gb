type StartupEnvironment = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  AUTH_SECRET?: string;
  USE_REDIS?: string;
  REDIS_URL?: string;
  WEBHOOK_ALLOW_PRIVATE?: string;
  API_URL?: string;
  FRONTEND_URL?: string;
  LOCAL_PREVIEW?: string;
  DATA_ENCRYPTION_KEY?: string;
};

/** Hosts a production build may be served from over plain http (local runs). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * API_URL is this API's public origin. In production it is required: SSO
 * redirect and SAML ACS URLs and avatar links are built from it, and the
 * fallback - the request's Host header - is attacker-controlled.
 */
/**
 * FRONTEND_URL in production: required, every origin an absolute https URL,
 * and never this machine (localhost / 127.0.0.1 / [::1]).
 */
function validateFrontendUrl(
  value: string | undefined,
  localPreview: boolean,
): void {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error('FRONTEND_URL must be set in production');
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`FRONTEND_URL origin ${origin} is not an absolute URL`);
    }
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      // `bun run preview` serves the web app from this machine over http.
      if (localPreview) continue;
      throw new Error(
        `FRONTEND_URL must not include ${origin} in production (localhost is not allowed)`,
      );
    }
    if (url.protocol !== 'https:') {
      throw new Error(`FRONTEND_URL origin ${origin} must use https in production`);
    }
  }
}

function validateApiUrl(value: string | undefined): void {
  const apiUrl = value?.trim();
  if (!apiUrl) {
    throw new Error('API_URL must be set in production');
  }
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('API_URL must be an absolute http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('API_URL must be an absolute http(s) URL');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('API_URL must use https in production');
  }
}

export function validateStartupConfig(
  env: StartupEnvironment = process.env,
): void {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set');
  }
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error();
    }
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  if (
    env.NODE_ENV === 'production' &&
    (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
  ) {
    throw new Error('AUTH_SECRET must be set (32+ characters) in production');
  }

  // Optional, but a short key would only fail later, on the first secret
  // read or written; refuse it at boot instead.
  if (
    env.DATA_ENCRYPTION_KEY !== undefined &&
    env.DATA_ENCRYPTION_KEY !== '' &&
    env.DATA_ENCRYPTION_KEY.length < 32
  ) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32+ characters when set');
  }

  if (env.NODE_ENV === 'production') {
    validateApiUrl(env.API_URL);
    validateFrontendUrl(env.FRONTEND_URL, env.LOCAL_PREVIEW === 'true');
  }

  if (env.USE_REDIS === 'true') {
    const redisUrl = env.REDIS_URL?.trim();
    if (!redisUrl) {
      throw new Error('REDIS_URL must be set when USE_REDIS=true');
    }
    try {
      const url = new URL(redisUrl);
      if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
        throw new Error();
      }
    } catch {
      throw new Error('REDIS_URL must be a valid Redis connection URL');
    }
  }

  if (
    env.WEBHOOK_ALLOW_PRIVATE !== undefined &&
    env.WEBHOOK_ALLOW_PRIVATE !== 'true' &&
    env.WEBHOOK_ALLOW_PRIVATE !== 'false'
  ) {
    throw new Error('WEBHOOK_ALLOW_PRIVATE must be "true" or "false"');
  }
}
