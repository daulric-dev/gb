import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Authentication is on by default: AuthGuard is an APP_GUARD (app.module.ts),
 * so every route needs a session unless it is marked @Public().
 *
 * This test holds the complete list of public routes. A new one fails here
 * until it is added below deliberately, which is the point: the global guard
 * stops a controller from being unauthenticated by accident, and this stops
 * @Public() from being added without anyone noticing.
 *
 * It reads the source rather than booting the application, because booting
 * AppModule needs a database, Redis and object storage. The parse only has to
 * cope with this codebase's own formatting, which eslint and prettier keep
 * uniform: one decorator per line, never wrapped.
 */

/** `backend/src`: this file lives in `backend/src/auth`. */
const SRC = join(__dirname, '..');

/** Every route the API answers without a session, as `METHOD path`. */
const PUBLIC_ROUTES = [
  // Liveness. Caddy's active health check polls it.
  'GET /',
  // The mobile app asks on launch, signed in or not.
  'GET app/version',
  // Avatars, course banners and school logos: rendered as plain image
  // sources with no credentials. Names carry 128 random bits.
  'GET images/avatars/:name',
  'GET images/:area/:name',
  // The attendance QR lands on a page with no signed-in student yet.
  'POST attendance/scan-claim',
  // Signed report links: the token is the credential, 5 minutes, one document.
  'GET report-cards/files/:token',
  // Sign-in itself.
  'POST auth/otp/send',
  'POST auth/otp/verify',
  // Dev-only; 404s unless NODE_ENV !== production and ALLOW_DEV_LOGIN=true.
  'POST auth/dev/code',
  // Finishes a sign-in that answered 403 MFA_REQUIRED, before a session exists.
  'POST auth/mfa/verify',
  // Single sign-on: browser navigations and the IdP's own cross-site POST.
  'GET auth/sso/providers',
  'GET auth/sso/discover',
  'GET auth/sso/saml/metadata',
  'POST auth/sso/saml/acs',
  'GET auth/sso/:provider/start',
  'GET auth/sso/callback',
  'POST auth/sso/handoff',
  // LTI: a tool calls these with no GradeBook session. A launch is authorised
  // by its single-use ticket, the token endpoint by a signed client assertion.
  'GET lti/jwks',
  'GET lti/auth',
  'POST lti/auth',
  'POST lti/token',
  // LTI Assignment and Grade Services: authenticated by LtiAgsGuard's own
  // bearer token check, not by a session.
  'GET lti/ags/courses/:courseId/lineitems',
  'POST lti/ags/courses/:courseId/lineitems',
  'GET lti/ags/courses/:courseId/lineitems/:lineItemId',
  'POST lti/ags/courses/:courseId/lineitems/:lineItemId/scores',
  'GET lti/ags/courses/:courseId/lineitems/:lineItemId/results',
].sort();

/**
 * The decorators are taken apart with string operations, not patterns.
 *
 * A pattern for `@Controller( 'x' )` wants `\(\s*(?:'([^']*)')?\s*\)`, and
 * those two `\s*` around a group that can match nothing are ambiguous: a run
 * of spaces can be split between them many ways, which is what code scanning
 * flags as a backtracking risk (CWE-1333). The input here is this repository's
 * own source, so nothing could exploit it - but the rule is worth keeping
 * whole, and the scanner is right that the pattern is the wrong tool.
 */

const ROUTE_DECORATORS = [
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'All',
  'QueryMethod',
] as const;

/** The decorator name on a line (`  @Get('x')` gives `Get`), or null. */
function decoratorName(line: string): string | null {
  const text = line.trimStart();
  if (!text.startsWith('@')) return null;
  let end = 1;
  while (end < text.length && isWordChar(text[end])) end++;
  return end > 1 ? text.slice(1, end) : null;
}

function isWordChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_'
  );
}

/**
 * The single quoted string a decorator was called with: `@Controller('x')`
 * gives `x`, `@Get()` gives `''`. Null when it is called with something else
 * (an object, a variable), which no route or controller decorator here is.
 */
function decoratorArgument(text: string): string | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open === -1 || close < open) return null;
  const inner = text.slice(open + 1, close).trim();
  if (inner === '') return '';
  const quote = inner[0];
  if (quote !== "'" && quote !== '"') return null;
  if (inner.length < 2 || inner[inner.length - 1] !== quote) return null;
  const value = inner.slice(1, -1);
  // A second quote inside would mean more than one argument.
  return value.includes(quote) ? null : value;
}

/** `@UseGuards(A, B)` gives `['A', 'B']`. */
function guardsOf(text: string): string[] {
  if (decoratorName(text) !== 'UseGuards') return [];
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open === -1 || close < open) return [];
  return text
    .slice(open + 1, close)
    .split(',')
    .map((guard) => guard.trim())
    .filter(Boolean);
}

/** `export class Foo` gives `Foo`, otherwise null. */
function exportedClassName(line: string): string | null {
  const text = line.trimStart();
  const prefix = 'export class ';
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length);
  let end = 0;
  while (end < rest.length && isWordChar(rest[end])) end++;
  return end > 0 ? rest.slice(0, end) : null;
}

/** A blank line, or one that only carries a comment. */
function isIgnored(line: string): boolean {
  const text = line.trimStart();
  return (
    text === '' ||
    text.startsWith('//') ||
    text.startsWith('/*') ||
    text.startsWith('*')
  );
}

interface Route {
  file: string;
  method: string;
  path: string;
  isPublic: boolean;
  guards: string[];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

/** Join a controller prefix and a route path the way Nest does. */
function joinPath(prefix: string, path: string): string {
  const segments = [prefix, path]
    .flatMap((part) => part.split('/'))
    .filter(Boolean);
  return segments.join('/') || '/';
}

/**
 * One decorator, which may be written over several lines (`@Throttle({ ... })`
 * is). Returns its whole text and the index of the line after it.
 */
function readDecorator(lines: string[], start: number): { text: string; next: number } {
  let depth = 0;
  let seenParen = false;
  let text = '';
  let i = start;
  for (; i < lines.length; i++) {
    text += (text ? '\n' : '') + lines[i];
    for (const ch of lines[i]) {
      if (ch === '(') {
        depth++;
        seenParen = true;
      } else if (ch === ')') depth--;
    }
    if (seenParen && depth <= 0) return { text, next: i + 1 };
    // A decorator with no arguments at all (`@Injectable`).
    if (!seenParen) return { text, next: i + 1 };
  }
  return { text, next: i };
}

/**
 * Every route in one file, with the decorators that apply to it: the ones on
 * its own handler and the ones on its controller class.
 */
function routesIn(file: string): Route[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const routes: Route[] = [];

  let inController = false;
  let prefix = '';
  let classPublic = false;
  let classGuards: string[] = [];

  let i = 0;
  while (i < lines.length) {
    if (decoratorName(lines[i]) === null) {
      i++;
      continue;
    }

    // Collect the whole contiguous decorator block, then its target.
    const block: string[] = [];
    while (i < lines.length && decoratorName(lines[i]) !== null) {
      const { text, next } = readDecorator(lines, i);
      block.push(text);
      i = next;
    }
    while (i < lines.length && isIgnored(lines[i])) i++;
    const target = lines[i] ?? '';

    const isPublic = block.some((d) => decoratorName(d) === 'Public');
    const guards = block.flatMap(guardsOf);

    const controller = block.find((d) => decoratorName(d) === 'Controller');
    if (exportedClassName(target) !== null) {
      const controllerPath = controller ? decoratorArgument(controller) : null;
      if (controllerPath !== null) {
        prefix = controllerPath;
        classPublic = isPublic;
        classGuards = guards;
        inController = true;
      } else {
        inController = false;
      }
      continue;
    }

    if (!inController) continue;
    const route = block.find((d) => {
      const name = decoratorName(d);
      return (
        name !== null &&
        (ROUTE_DECORATORS as readonly string[]).includes(name) &&
        decoratorArgument(d) !== null
      );
    });
    if (!route) continue;
    const name = decoratorName(route)!;
    routes.push({
      file,
      method: name === 'QueryMethod' ? 'QUERY' : name.toUpperCase(),
      path: joinPath(prefix, decoratorArgument(route)!),
      isPublic: classPublic || isPublic,
      guards: [...classGuards, ...guards],
    });
  }

  return routes;
}

const allRoutes = sourceFiles(SRC).flatMap(routesIn);

describe('route authentication coverage', () => {
  test('finds the controllers (guards against a parse that silently matches nothing)', () => {
    // 630 routes across 81 files when this was written. The floors are set
    // just below that: a parser change that quietly stops seeing a whole
    // controller would otherwise leave its routes unchecked and still pass.
    expect(allRoutes.length).toBeGreaterThanOrEqual(600);
    const files = new Set(allRoutes.map((r) => r.file));
    expect(files.size).toBeGreaterThanOrEqual(78);
  });

  test('the public routes are exactly the ones listed here', () => {
    const found = allRoutes
      .filter((r) => r.isPublic)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect([...new Set(found)]).toEqual(PUBLIC_ROUTES);
  });

  test('every other route is authenticated', () => {
    // AuthGuard is global, so a route that is not @Public() is covered. This
    // asserts the inverse of the list above: nothing escapes both.
    const uncovered = allRoutes
      .filter((r) => !r.isPublic)
      .filter((r) => PUBLIC_ROUTES.includes(`${r.method} ${r.path}`));
    expect(uncovered).toEqual([]);
  });

  test('no public route carries a permission or admin guard it cannot satisfy', () => {
    // A @Public() route has no request.user, so these guards would always
    // refuse it. LtiAgsGuard is fine: it authenticates callers itself.
    const sessionGuards = ['PermissionGuard', 'AdminGuard', 'StudentGuard', 'ParentGuard', 'OrganisationAdminGuard'];
    const contradictions = allRoutes
      .filter((r) => r.isPublic && r.guards.some((g) => sessionGuards.includes(g)))
      .map((r) => `${r.method} ${r.path} (${r.file})`);
    expect(contradictions).toEqual([]);
  });
});
