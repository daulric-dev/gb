type StartupEnvironment = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  AUTH_SECRET?: string;
  USE_REDIS?: string;
  REDIS_URL?: string;
  WEBHOOK_ALLOW_PRIVATE?: string;
};

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
