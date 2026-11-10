import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('per-route throttle limits', () => {
  // The 'default' throttler keeps ONE counter per session across every route
  // (generateKey in app.module.ts). Overriding its limit on a single route
  // compares that route's small limit against everything the session has
  // called, so a busy page gets 429 on its first click. Per-route limits use
  // the 'route' throttler, whose counter is per route.
  test('no route overrides the shared default throttler', () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /@Throttle\(\s*\{\s*default\s*:/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  test('the route throttler is configured and only applies where declared', () => {
    const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
    expect(appModule).toContain("name: 'route'");
    expect(appModule).toContain("skipIf: skipUnlessDeclared('route')");
  });
});
