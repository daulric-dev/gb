'use strict';

// PM2 entry point for one API instance (apps.cjs): picks this instance's
// port, starts the compiled backend as `bun dist/src/main.js` would, and
// tells PM2 "ready" once it answers HTTP.

const path = require('node:path');

// Instance N listens on API_BASE_PORT + N. Computed here rather than with
// PM2's increment_var, which a reload with --update-env does not re-apply
// (every instance would come back on the base port and fail with
// EADDRINUSE). NODE_APP_INSTANCE is PM2's stable per-instance index.
if (process.env.API_BASE_PORT) {
  const base = Number(process.env.API_BASE_PORT);
  const index = Number(process.env.NODE_APP_INSTANCE || 0);
  process.env.PORT = String(base + index);
}

require(path.resolve(__dirname, '../../backend/dist/src/main.js'));

// Readiness: with `wait_ready`, PM2 restarts the next instance only after
// this message (or listen_timeout), so a reload never has every instance
// down at once. Probes `GET /`, the liveness route Caddy checks; not
// /health, which fails while a shared dependency is down and would stall
// every reload.
const port = process.env.PORT || '3001';
const intervalMs = 250;
const deadline = Date.now() + Number(process.env.API_READY_TIMEOUT_MS || 60_000);

async function probe() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    if (res.ok) {
      if (typeof process.send === 'function') process.send('ready');
      return;
    }
  } catch {
    // Not listening yet.
  }
  if (Date.now() < deadline) setTimeout(probe, intervalMs).unref();
}

setTimeout(probe, intervalMs).unref();
