import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { encryptSensitiveText } from './sensitive-text';

/**
 * Once per boot, in the background: encrypt any pastoral note text or
 * accommodation reason still stored as plain text (rows written before
 * encryption at rest; see sensitive-text.ts). Batched, behind an advisory
 * lock, idempotent, and conditional per row, so it is safe with several API
 * instances and with people editing at the same time. After the first boot
 * on a version with encryption it finds nothing to do.
 *
 * Off when NODE_ENV=test or SENSITIVE_TEXT_BACKFILL=false (then run
 * `bun run secrets:reencrypt`, which does the same and also moves values
 * onto DATA_ENCRYPTION_KEY).
 */
@Injectable()
export class SensitiveTextBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SensitiveTextBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.SENSITIVE_TEXT_BACKFILL === 'false') return;
    void this.run();
  }

  /** Never throws. */
  async run(): Promise<void> {
    try {
      const report = await encryptSensitiveText(this.prisma);
      const rewritten = Object.values(report).reduce((n, c) => n + c.rewritten, 0);
      if (rewritten > 0) {
        this.logger.log(
          `Encrypted ${rewritten} stored text value(s): ` +
            Object.entries(report)
              .map(([name, c]) => `${name} ${c.rewritten}`)
              .join(', '),
        );
      }
    } catch (err) {
      this.logger.error(`Encrypting stored text failed: ${(err as Error).message}`);
    }
  }
}
