/**
 * Which relational database the backend is talking to. Prisma generates one
 * client per provider (`datasource.provider` in prisma/schema/main.prisma),
 * so the generated client is the authority; the connection URL is the
 * fallback when no client is at hand (scripts, early boot).
 */
export type DatabaseProvider =
  | 'postgresql'
  | 'cockroachdb'
  | 'mysql'
  | 'sqlite'
  | 'sqlserver'
  | 'unknown';

const KNOWN: readonly DatabaseProvider[] = [
  'postgresql',
  'cockroachdb',
  'mysql',
  'sqlite',
  'sqlserver',
];

/** The provider a connection URL points at, from its scheme only. */
export function providerFromUrl(url: string | undefined | null): DatabaseProvider {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec((url ?? '').trim())?.[1]?.toLowerCase();
  switch (scheme) {
    case 'postgres':
    case 'postgresql':
      return 'postgresql';
    case 'cockroachdb':
      return 'cockroachdb';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    case 'file':
    case 'sqlite':
      return 'sqlite';
    case 'sqlserver':
      return 'sqlserver';
    default:
      return 'unknown';
  }
}

/**
 * The provider of a generated Prisma client instance (Prisma keeps it as
 * `_activeProvider`), or null when the object does not carry one (a
 * transaction client, a test mock).
 */
export function clientProvider(client: unknown): DatabaseProvider | null {
  const value = (client as { _activeProvider?: unknown } | null)?._activeProvider;
  return typeof value === 'string' && (KNOWN as string[]).includes(value)
    ? (value as DatabaseProvider)
    : null;
}

/**
 * The provider to use: the generated client's when known (CockroachDB uses
 * `postgresql://` URLs, so the URL alone cannot tell it from PostgreSQL),
 * otherwise the URL's scheme.
 */
export function detectProvider(input: {
  client?: unknown;
  url?: string | null;
}): DatabaseProvider {
  return clientProvider(input.client) ?? providerFromUrl(input.url);
}
