// PM2 process file for `bun run preview` (preview.sh): the production builds
// on this machine, with the development backend/.env. Same apps as
// ecosystem.config.cjs, named gradebook-preview-*, one API instance by
// default and LOCAL_PREVIEW=true (allows the http://localhost FRONTEND_URL).
// Never use this file on a server.
'use strict';

const { buildApps } = require('./apps.cjs');

module.exports = { apps: buildApps({ preview: true }) };
