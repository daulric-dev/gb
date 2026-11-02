import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisPubSubService } from '@/realtime/redis-pubsub.service';
import { StorageService } from '@/storage/storage.service';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export type HealthStatus = {
  status: 'ok' | 'error';
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down' | 'disabled';
    s3: 'up' | 'down';
  };
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisPubSubService,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthStatus> {
    const [database, redis, s3] = await Promise.all([
      this.withTimeout(this.prisma.$queryRaw`SELECT 1`).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      this.withTimeout(this.redis.checkHealth()).then(
        (status) => status,
        () => 'down' as const,
      ),
      this.withTimeout(this.storage.checkHealth()).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);

    const healthy = database === 'up' && redis !== 'down' && s3 === 'up';
    return {
      status: healthy ? 'ok' : 'error',
      services: { database, redis, s3 },
    };
  }

  private async withTimeout<T>(check: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        check,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Health check timed out')),
            HEALTH_CHECK_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
