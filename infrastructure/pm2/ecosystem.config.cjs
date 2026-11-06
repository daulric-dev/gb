// PM2 process file for running GradeBook on a server or VM without Docker
// (Docker Compose stays the primary deployment). deploy.sh runs
//   pm2 startOrReload infrastructure/pm2/ecosystem.config.cjs --update-env
//
//   gradebook-api  NestJS API (backend/dist) on Bun, fork mode, API_INSTANCES
//                  processes on API_BASE_PORT, +1, ... (default 3001-3003)
//   gradebook-web  Next.js frontend (`next start`) on Node, cluster mode,
//                  WEB_INSTANCES workers sharing WEB_PORT (default 3000)
//
// The API reads backend/.env (Bun loads it from backend/, the working
// directory); the shell environment wins over it. Definitions and tuning
// variables: apps.cjs and README.md.
'use strict';

const { buildApps } = require('./apps.cjs');

module.exports = { apps: buildApps() };
