import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };
  const redis = {
    checkHealth: jest.fn(),
  };
  const storage = {
    checkHealth: jest.fn(),
  };
  let health: HealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    redis.checkHealth.mockResolvedValue('disabled');
    storage.checkHealth.mockResolvedValue(undefined);
    health = new HealthService(prisma as never, redis as never, storage as never);
  });

  test('reports healthy when the database is up and Redis is disabled', async () => {
    await expect(health.check()).resolves.toEqual({
      status: 'ok',
      services: { database: 'up', redis: 'disabled', s3: 'up' },
    });
  });

  test('reports unhealthy when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('database unavailable'));

    await expect(health.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'down', redis: 'disabled', s3: 'up' },
    });
  });

  test('reports unhealthy when Redis is down', async () => {
    redis.checkHealth.mockRejectedValue(new Error('Redis unavailable'));

    await expect(health.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'up', redis: 'down', s3: 'up' },
    });
  });

  test('reports healthy when Redis is up', async () => {
    redis.checkHealth.mockResolvedValue('up');

    await expect(health.check()).resolves.toEqual({
      status: 'ok',
      services: { database: 'up', redis: 'up', s3: 'up' },
    });
  });

  test('reports unhealthy when S3 is down', async () => {
    storage.checkHealth.mockRejectedValue(new Error('S3 unavailable'));

    await expect(health.check()).resolves.toEqual({
      status: 'error',
      services: { database: 'up', redis: 'disabled', s3: 'down' },
    });
  });
});
