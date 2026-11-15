import { PostgresHardening } from './postgresql/postgres-hardening';
import type { DatabaseProvider } from './provider';
import { emptyReport, type DatabaseHardening, type HardeningReport } from './types';

/**
 * A provider with no database-level hardening yet: every guarantee rests on
 * the application (prisma/DATABASE_PORTABILITY.md lists which ones). Says so
 * loudly instead of silently doing nothing.
 */
export class ApplicationOnlyHardening implements DatabaseHardening {
  constructor(readonly provider: DatabaseProvider) {}

  private report(phase: string): HardeningReport {
    const report = emptyReport(this.provider, false);
    report.warnings.push(
      `No ${phase} database hardening is implemented for provider "${this.provider}": ` +
        'only application-level enforcement applies (audit append-only, student left_at, ' +
        'peer-review not-self, uniqueness and CHECK rules). See prisma/DATABASE_PORTABILITY.md.',
    );
    return report;
  }

  prepare(): Promise<HardeningReport> {
    return Promise.resolve(this.report('pre-push'));
  }

  apply(): Promise<HardeningReport> {
    return Promise.resolve(this.report('post-push'));
  }
}

/** The hardening implementation for a provider. */
export function hardeningFor(provider: DatabaseProvider): DatabaseHardening {
  switch (provider) {
    case 'postgresql':
      return new PostgresHardening();
    default:
      // CockroachDB speaks most of PostgreSQL but not all of what the
      // PostgreSQL implementation uses (plpgsql triggers, NOT VALID, ...);
      // it needs its own implementation and conformance run.
      return new ApplicationOnlyHardening(provider);
  }
}
