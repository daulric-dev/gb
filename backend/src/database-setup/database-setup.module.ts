import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { hardenDatabase, hardenOnBoot } from './database-setup';

/**
 * Opt-in boot check: with DB_HARDEN_ON_BOOT=true each API instance runs the
 * post-push hardening and setup steps (`bun run db:harden`) in the
 * background after it starts. Off by default, in production too: the
 * release step (`bun run db:release`) already runs it once per deploy,
 * before the new code serves traffic, and a boot run competes with traffic
 * for locks while it validates CHECK constraints. It never runs
 * `prisma db push` or the pre-push step.
 */
@Injectable()
export class DatabaseSetupBoot implements OnApplicationBootstrap {
  private readonly logger = new Logger('DatabaseSetup');

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (!hardenOnBoot()) return;
    void this.run();
  }

  async run(): Promise<boolean> {
    try {
      const ok = await hardenDatabase(this.prisma, this.logger);
      if (!ok) this.logger.error('Database setup reported failures; run `bun run db:harden` for details.');
      return ok;
    } catch (err) {
      this.logger.error(`Database setup failed: ${(err as Error).message}`);
      return false;
    }
  }
}

@Module({ providers: [DatabaseSetupBoot] })
export class DatabaseSetupModule {}
