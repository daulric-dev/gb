import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'bun:test';

test('workspace test suites', () => {
  const result = spawnSync('bun', ['run', 'test'], {
    cwd: resolve(import.meta.dir, '..'),
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    throw new Error(`Workspace test suites failed (${reason})`);
  }
});
