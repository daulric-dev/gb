// PM2 app definitions shared by ecosystem.config.cjs (servers) and
// preview.config.cjs (`bun run preview` on a laptop). See README.md for the
// variables; each is read from the environment of the shell running pm2.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendDir = path.join(repoRoot, 'backend');
const frontendDir = path.join(repoRoot, 'frontend');

const env = process.env;

function positiveInt(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

/**
 * Minimal reader for backend/.env (KEY=value lines, optional quotes), only to
 * check settings here; Bun parses the file itself when the API starts.
 */
function readDotenv(file) {
  const values = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

/**
 * @param {{ preview?: boolean }} options
 *   preview: local production preview (`bun run preview`): one API instance
 *   by default, LOCAL_PREVIEW=true so the dev backend/.env (http localhost
 *   FRONTEND_URL) passes the production startup checks, separate app names.
 */
function buildApps({ preview = false } = {}) {
  const prefix = preview ? 'gradebook-preview' : 'gradebook';
  const logDir = path.resolve(env.PM2_LOG_DIR || path.join(__dirname, 'logs'));

  // The environment overrides backend/.env, as it does for Bun.
  const backendEnv = { ...readDotenv(path.join(backendDir, '.env')), ...env };

  const apiInstances = positiveInt('API_INSTANCES', preview ? 1 : 3);
  const apiBasePort = positiveInt('API_BASE_PORT', 3001);
  const webPort = positiveInt('WEB_PORT', 3000);
  const webInstances =
    env.WEB_INSTANCES === 'max' ? 'max' : positiveInt('WEB_INSTANCES', 1);
  // Servers: loopback only, Caddy on the same host proxies to it. Preview:
  // Next.js's default (every interface), as `next start` did before.
  const webHost = env.WEB_HOST ?? (preview ? '' : '127.0.0.1');

  // Every API process keeps its own in-memory cache, realtime bus, presence
  // and rate-limit counters unless they share Redis: with several processes,
  // chat and live updates would reach only the clients of one process.
  if (apiInstances > 1 && backendEnv.USE_REDIS !== 'true') {
    throw new Error(
      `API_INSTANCES=${apiInstances} needs USE_REDIS=true and REDIS_URL in backend/.env ` +
        '(cache, realtime pub/sub, presence and rate limits must be shared ' +
        'between processes). Enable Redis or set API_INSTANCES=1.',
    );
  }
  // LOCAL_PREVIEW relaxes the production FRONTEND_URL check for a local
  // preview; it must never reach a server.
  if (!preview && backendEnv.LOCAL_PREVIEW === 'true') {
    throw new Error(
      'LOCAL_PREVIEW=true is for local previews only; remove it from backend/.env and the environment.',
    );
  }

  // Shared restart, shutdown and logging behaviour.
  const common = {
    autorestart: true,
    // Crash-loop protection: wait 100ms after a crash, doubling up to 15s;
    // reset once a process stays up 30s.
    exp_backoff_restart_delay: 100,
    min_uptime: '30s',
    // What Docker sends too; Nest's shutdown hooks handle it.
    kill_signal: 'SIGTERM',
    // All instances of an app share one stdout and one stderr file, every
    // line prefixed with a timestamp.
    merge_logs: true,
    log_date_format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
    watch: false,
  };

  const api = {
    ...common,
    name: `${prefix}-api`,
    cwd: backendDir,
    // Bun has no Node `cluster` module, which PM2's cluster mode relies on,
    // so each instance is a separate forked process on its own port.
    interpreter: env.BUN_PATH || 'bun',
    exec_mode: 'fork',
    // Starts backend/dist/src/main.js and reports "ready" once it serves HTTP
    // (api-ready.cjs), so a reload restarts one instance at a time.
    script: path.join(__dirname, 'api-ready.cjs'),
    instances: apiInstances,
    // Instance N listens on API_BASE_PORT + N (set in api-ready.cjs).
    wait_ready: true,
    // Longest wait for an instance to answer before PM2 moves on anyway.
    // Boot takes seconds (deploy.sh runs migrations beforehand).
    listen_timeout: 30_000,
    // Shutdown: Nest runs its destroy hooks (queue workers, Redis, Prisma),
    // then closes the HTTP server, which waits for open requests. Open SSE
    // streams never end on their own, so they hold the process until this
    // timeout and are then cut (SIGKILL); clients reconnect (`retry: 5000`)
    // to another instance through Caddy.
    kill_timeout: positiveInt('API_KILL_TIMEOUT', 15_000),
    max_memory_restart: env.API_MAX_MEMORY || '2G',
    out_file: path.join(logDir, `${prefix}-api.out.log`),
    error_file: path.join(logDir, `${prefix}-api.error.log`),
    env: {
      NODE_ENV: 'production',
      API_BASE_PORT: apiBasePort,
      API_READY_TIMEOUT_MS: 35_000,
      ...(preview ? { LOCAL_PREVIEW: 'true' } : {}),
    },
  };

  const web = {
    ...common,
    name: `${prefix}-web`,
    cwd: frontendDir,
    // Bun's isolated linker keeps packages in node_modules/.bun and links
    // them into each workspace, so `next` is frontend/node_modules/next.
    script: path.join(frontendDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
    args: ['start', '--port', String(webPort), ...(webHost ? ['--hostname', webHost] : [])],
    // Next.js needs Node >= 20.9. Cluster workers are forked by the PM2
    // daemon with its own Node, so PM2 must run on that Node too.
    interpreter: 'node',
    // Preview needs only one web process, so it runs forked.
    exec_mode: preview ? 'fork' : 'cluster',
    instances: preview ? 1 : webInstances,
    // A cluster reload starts the new worker and waits for it to listen
    // before stopping the old one.
    listen_timeout: 30_000,
    kill_timeout: 10_000,
    max_memory_restart: env.WEB_MAX_MEMORY || '1G',
    out_file: path.join(logDir, `${prefix}-web.out.log`),
    error_file: path.join(logDir, `${prefix}-web.error.log`),
    env: {
      NODE_ENV: 'production',
      PORT: webPort,
    },
  };

  return [api, web];
}

module.exports = { buildApps };
