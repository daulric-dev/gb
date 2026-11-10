import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { LibraryImportService } from './library-import.service';
import {
  LIBRARY_IMPORT_RESUME_LOCK,
  LIBRARY_IMPORT_RESUME_TICK_MS,
} from './library.constants';

/**
 * Resumes library imports a restart left behind (see
 * LibraryImportService.resumeStale): once after boot, then every
 * LIBRARY_IMPORT_RESUME_TICK_MS, one instance at a time (advisory lock).
 * Nothing runs under NODE_ENV=test.
 */
@Injectable()
export class LibraryImportScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LibraryImportScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: LibraryImportService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), LIBRARY_IMPORT_RESUME_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One sweep, if this instance gets the lock. Never throws. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LIBRARY_IMPORT_RESUME_LOCK})) AS locked`;
          if (!rows?.[0]?.locked) return;
          const out = await this.imports.resumeStale(now);
          if (out.resumed + out.failed > 0) {
            this.logger.log(`Library imports: ${out.resumed} resumed, ${out.failed} out of attempts`);
          }
        },
        { maxWait: 10_000, timeout: 5 * 60_000 },
      );
    } catch (err) {
      this.logger.error(`Library import resume sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
