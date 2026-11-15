import { describe, expect, test } from 'bun:test';
import { clientProvider, detectProvider, providerFromUrl } from './provider';
import { ApplicationOnlyHardening, hardeningFor } from './hardening';
import { PostgresHardening } from './postgresql/postgres-hardening';

describe('provider selection', () => {
  test('from the connection URL scheme', () => {
    expect(providerFromUrl('postgresql://u:p@h:5432/db')).toBe('postgresql');
    expect(providerFromUrl('postgres://h/db')).toBe('postgresql');
    expect(providerFromUrl('mysql://h/db')).toBe('mysql');
    expect(providerFromUrl('mariadb://h/db')).toBe('mysql');
    expect(providerFromUrl('file:./dev.db')).toBe('sqlite');
    expect(providerFromUrl('sqlserver://h:1433;database=db')).toBe('sqlserver');
    expect(providerFromUrl('')).toBe('unknown');
    expect(providerFromUrl(undefined)).toBe('unknown');
    expect(providerFromUrl('nonsense')).toBe('unknown');
  });

  test('the generated client wins over the URL (CockroachDB uses postgresql:// URLs)', () => {
    expect(clientProvider({ _activeProvider: 'cockroachdb' })).toBe('cockroachdb');
    expect(clientProvider({ _activeProvider: 'mongodb' })).toBeNull();
    expect(clientProvider({})).toBeNull();
    expect(detectProvider({ client: { _activeProvider: 'cockroachdb' }, url: 'postgresql://h/db' })).toBe('cockroachdb');
    expect(detectProvider({ client: {}, url: 'mysql://h/db' })).toBe('mysql');
  });

  test('PostgreSQL gets the PostgreSQL hardening; every other provider is application-only', async () => {
    expect(hardeningFor('postgresql')).toBeInstanceOf(PostgresHardening);
    for (const p of ['mysql', 'sqlite', 'sqlserver', 'cockroachdb', 'unknown'] as const) {
      const h = hardeningFor(p);
      expect(h).toBeInstanceOf(ApplicationOnlyHardening);
      const report = await h.apply({} as any);
      expect(report.implemented).toBe(false);
      expect(report.results).toEqual([]);
      expect(report.warnings[0]).toContain('only application-level enforcement applies');
      expect((await h.prepare({} as any)).warnings).toHaveLength(1);
    }
  });
});
