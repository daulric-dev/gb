/**
 * Starts the Stripe webhook listener for local development and keeps
 * backend/.env's STRIPE_WEBHOOK_SECRET in step with it.
 *
 *   bun run stripe:listen          (also run by `bun run preload`)
 *
 * Does nothing unless backend/.env has BILLING_ENABLED=true and a Stripe
 * sandbox key (sk_test_ / rk_test_). Live keys are refused: this is for
 * development only. The listener runs in Docker (`stripe-listen` in
 * docker-compose.dev.yml) and forwards to the API on localhost:3001.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const envPath = join(root, 'backend', '.env');
const compose = ['docker', 'compose', '-f', join(root, 'docker-compose.dev.yml'), '--profile', 'stripe'];

function readEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

let text: string;
try {
  text = readFileSync(envPath, 'utf8');
} catch {
  console.log('stripe: backend/.env not found - skipping the webhook listener');
  process.exit(0);
}
const env = readEnv(text);
const key = env.STRIPE_SECRET_KEY ?? '';

if (env.BILLING_ENABLED !== 'true') {
  console.log('stripe: BILLING_ENABLED is not true - skipping the webhook listener');
  process.exit(0);
}
if (!key) {
  console.log('stripe: no STRIPE_SECRET_KEY in backend/.env - skipping the webhook listener');
  process.exit(0);
}
if (!/^(sk|rk)_test_/.test(key)) {
  console.error('stripe: STRIPE_SECRET_KEY is not a sandbox (test) key - refusing to forward live events locally');
  process.exit(1);
}

// The listener's signing secret belongs to the API key, so it is stable
// across restarts; ask the CLI for it and update .env if it changed.
const secretRun = Bun.spawnSync(
  [...compose, 'run', '--rm', '--no-deps', '--entrypoint', 'stripe', 'stripe-listen', 'listen', '--api-key', key, '--print-secret'],
  { stdout: 'pipe', stderr: 'pipe' },
);
const secret = /whsec_[A-Za-z0-9]+/.exec(secretRun.stdout.toString())?.[0];
if (!secret) {
  console.error('stripe: could not get the webhook signing secret from the Stripe CLI:');
  console.error(secretRun.stderr.toString().trim() || secretRun.stdout.toString().trim());
  process.exit(1);
}
if (env.STRIPE_WEBHOOK_SECRET !== secret) {
  const line = `STRIPE_WEBHOOK_SECRET=${secret}`;
  const updated = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(text)
    ? text.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line)
    : `${text.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(envPath, updated);
  console.log('stripe: updated STRIPE_WEBHOOK_SECRET in backend/.env - restart the API to pick it up');
}

const up = Bun.spawnSync([...compose, 'up', '-d', 'stripe-listen'], { stdout: 'inherit', stderr: 'inherit' });
if (up.exitCode !== 0) process.exit(up.exitCode ?? 1);
console.log('stripe: forwarding sandbox webhooks to http://localhost:3001/api/billing/webhooks/stripe');
console.log('stripe: logs with `docker compose -f docker-compose.dev.yml logs -f stripe-listen`');
