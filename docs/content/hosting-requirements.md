---
sidebar_label: Hosting Requirements
---
# Hosting Requirements

This guide describes the runtime, services, network access, and initial resource
allocations for hosting GradeBook's web frontend and API. It is an operational
starting point, not a capacity guarantee: the project has no published minimum
hardware requirement or load-test-derived users-per-server figure. Measure the
deployment with representative schools and scale based on CPU, memory, database
connections, response times, and storage growth.

## Deployment shape

The web frontend and backend API are separate long-running applications:

```text
Browser / mobile app
  ├── HTTPS ──> Next.js frontend
  ├── HTTPS ──> GradeBook API ──> PostgreSQL
  │                              ├── Redis (optional for one API instance)
  │                              ├── S3-compatible object storage
  │                              └── SMTP provider
  └── HTTPS ──> S3-compatible object storage (direct file uploads)
```

The production Dockerfile in [`infrastructure/Dockerfile`](../../infrastructure/Dockerfile)
builds and runs the **backend only**. The production Compose stack also runs
Redis, an encrypted database-backup sidecar, and three API replicas behind
Caddy (reverse proxy with automatic HTTPS); it does not deploy the frontend, Postgres, or S3. Use a managed database
and S3 provider, or provision those services separately. See
[`infrastructure/SERVICES.md`](../../infrastructure/SERVICES.md) for the
Compose details and service behavior.

### Without Docker (PM2)

To run on a server or VM without containers, use the PM2 setup in
[`infrastructure/pm2/`](../../infrastructure/pm2/README.md): PM2 runs the API
on Bun (three processes on ports 3001-3003 by default, fork mode) and the
frontend with `next start` on Node, and a Caddy on the host terminates TLS for
both hostnames and balances over the API processes. `deploy.sh` installs,
builds, applies migrations and reloads the processes one at a time;
`setup.sh` installs PM2 and log rotation once per server. It needs Bun 1.4.4,
Node.js 20.9+, and the same PostgreSQL, Redis (required for more than one API
process), S3 and SMTP services as the Compose stack.

## Runtime requirements

| Component      | Runtime / version                       | Notes                                                                                                                                                                |
| -------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | Next.js 16 on Node.js 20.9 or newer     | Build with `NEXT_PUBLIC_API_URL` set. Keep the frontend process running with `next start` (the workspace command is `bun run start:prod`).                     |
| Backend        | The repository's Bun 1.4.4 Docker image | The API listens on `PORT` (default `3001`) on `0.0.0.0`. The image runs pending Prisma migrations at startup unless `MIGRATE_ON_START=false`.                |
| Database       | PostgreSQL 15 or newer                  | Required. Use any managed or self-hosted PostgreSQL provider in this version range. Apply migrations with `prisma migrate deploy`, not `migrate dev` or `migrate reset`. |
| Object storage | S3-compatible service                   | Required for uploads, files, and images. Give the API credentials to one bucket; clients must be able to reach the configured public endpoint for presigned uploads. |
| Email          | SMTP server/provider                    | Required for email-code sign-in. Configure TLS and a sender address accepted by the provider.                                                                        |
| Redis          | Redis-compatible service                | Optional for a single API instance. Required and shared by all API instances when horizontally scaling.                                                              |

Use the environment-variable reference for the complete configuration and
secret handling rules: [`Environment Variables`](./environment-variables.md).
The deployment template is [`infrastructure/env.example`](../../infrastructure/env.example).

Prisma supports several database engines, but it does not make an application
automatically portable between them. This project sets Prisma's datasource
provider to `postgresql`, and its migrations and raw SQL use PostgreSQL-specific
features. Supporting another Prisma provider would require adapting and testing
the schema, migrations, queries, and database behavior; it is not a
configuration-only change.

## Initial resource sizing

These are conservative **starting allocations for a small production pilot**,
not measured minimums. Allocate resources per service where possible. If
combining frontend and API on one host, use **4 vCPU and 8 GB RAM** as an
initial allocation for those two application processes together, then add
capacity for any local database, Redis, proxy, monitoring, and backup processes.

| Service     | Initial allocation                                                                                    | Scale or tune when                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend    | 1 vCPU, 1.5 GB RAM per instance                                                                       | SSR traffic, route rendering, or memory usage approaches the instance limit.                                                                                                                                  |
| Backend API | 2 vCPU, 2-4 GB RAM per instance                                                                       | Request latency, CPU, memory, or concurrent file verification is high. The default `UPLOAD_VERIFY_MEMORY_MB=256` is a per-process upload-verification budget; account for it in each API instance's memory. |
| PostgreSQL  | Start around 2 vCPU, 4 GB RAM for a small install; provision SSD storage for the database and indexes | Database size, connection count, slow queries, and backup/restore time grow. Disk capacity depends on school data and retention; monitor free space and provision growth headroom.                            |
| Redis       | 1 vCPU, 512 MB RAM is a reasonable starting point                                                     | Queue depth, memory use, or connection counts grow. Redis is shared by all API replicas.                                                                                                                      |
| S3 storage  | Provider-managed; size for uploads and backups separately                                             | Estimate from the school's file usage and retention policy. The application bucket and encrypted database-backup bucket should be separate.                                                                   |

Builds are not part of these runtime allocations. Run dependency installation,
Prisma generation, and frontend/backend builds on a build runner with adequate
temporary disk and memory. The app containers do not use local disk for durable
uploads; PostgreSQL and S3-compatible storage hold persistent data.

For production with availability requirements, run at least two frontend
instances and two API instances behind health-aware load balancers, use shared
Redis, and use managed/high-availability PostgreSQL with point-in-time recovery.
The repository's API Compose stack defaults to three replicas. A single API
instance can run without Redis, but a multi-instance deployment cannot safely
use per-process cache, realtime, presence, or queue state.

## Network and proxy requirements

- Terminate TLS for both the frontend and API. Expose HTTPS publicly; keep
  PostgreSQL and Redis on a private network and do not publish their ports to
  the internet. The Compose stack's Caddy can terminate TLS for the API itself
  (set `SITE_ADDRESS` to the API hostname): it needs the hostname's DNS pointing
  at the server and ports 80 and 443 reachable, and keeps its certificates in
  the `caddy_data` volume.
- The browser and mobile app must reach the API over HTTPS. Configure the API's
  `FRONTEND_URL` to the exact web origin and `API_URL` to the public API origin
  (no `/api` suffix). Set the frontend's `NEXT_PUBLIC_API_URL` to that same API
  origin; it is embedded in the frontend bundle at build time.
- Set `NEXT_PUBLIC_STORAGE_URL` to the public S3 endpoint's origin so the
  frontend's Content Security Policy permits browser uploads. Configure the
  bucket's CORS policy to allow `PUT` from the frontend origin, and allow the
  signed `Content-Type` header. The API and clients must be able to reach the
  storage endpoints used to sign and complete uploads.
- Allow the backend outbound connections to PostgreSQL, Redis when enabled,
  S3-compatible storage, and SMTP. Permit SMTP submission on the TLS-enabled
  port selected by the provider.
- Preserve `Host`, the real client IP, and the external HTTPS scheme through
  trusted proxies. Set `TRUST_PROXY_HOPS` to the actual number of trusted hops;
  never trust client-supplied forwarding headers directly.
- Proxies must support long-lived Server-Sent Events. Do not buffer API stream
  routes (`/api/chat/stream`, `/api/portal/me/stream`, and attendance streams);
  set generous read timeouts. Allow request bodies up to at least 16 MB for
  backend API requests. File bytes themselves upload directly to S3.

## Data protection requirements

GradeBook holds children's records, pastoral and safeguarding notes, and
health-related accommodation reasons. The application encrypts some of this
itself (chat messages with `CHAT_ENCRYPTION_KEY`; pastoral note text,
accommodation reasons, authenticator-app secrets and stored credentials with
`DATA_ENCRYPTION_KEY`), but most of the database, the uploaded files and the
logs are plain data on the hosting provider's disks. The hosting must protect
them.

### Database connections over TLS

A database on another host must be reached over TLS. Add `sslmode` to
`DATABASE_URL`:

```env
DATABASE_URL=postgresql://user:password@db.example.com:5432/gradebook?sslmode=verify-full
```

- `sslmode=verify-full` (recommended) encrypts the connection and checks that
  the server's certificate is valid and issued for that host name.
- `sslmode=require` is the minimum. With the `pg` driver GradeBook uses, it
  is currently treated like `verify-full` (the driver prints a deprecation
  warning); write `verify-full` so the intent is explicit.
- If the provider signs its certificates with its own certificate authority,
  download its CA bundle and add `&sslrootcert=/path/to/ca.pem`, or
  verification fails.

At startup the API logs a warning when `DATABASE_URL` points at another host
without `sslmode=require`, `verify-ca` or `verify-full` (or `ssl=true`). The
warning points here. A database on the same machine, a Unix socket, or a
single-label host name on the same Compose or cluster network (`db`,
`postgres`) is treated as local and does not trigger it. Run the backup
service's `BACKUP_DATABASE_URL` with the same `sslmode`.

### Encryption at rest

- Use disks encrypted at rest for PostgreSQL (data directory, WAL and any
  local dumps), Redis persistence if enabled, and any host that keeps
  container or proxy logs. Managed databases usually offer this as a setting:
  turn it on.
- Turn on server-side encryption for the application bucket (`S3_BUCKET`).
  Uploaded files, submissions, report card PDFs, data exports and the
  erasure-log copy are stored there as they are; GradeBook does not encrypt
  them itself.
- Database backups are encrypted by the backup service before upload (age
  public keys in `BACKUP_AGE_RECIPIENTS`; WAL-G with `WALG_LIBSODIUM_KEY`).
  Keep the private keys offline. See [Backups & GDPR](./backups.md).

### Where the data lives

For schools in the EU or UK, choose EU or UK regions (or a country with an
adequacy decision) for the database, the application bucket, the backup
buckets, Redis and the servers running the API and frontend. Choose
`BACKUP_S3_REGION` and `WALG_S3_REGION` deliberately: they have no default
for this reason. Record each provider, region and contract in the supplier
register; see [Sub-processors](./gdpr/sub-processors.md). Enter the hosting
location under **Organisation → Privacy** so the privacy notice states it.

### Strong sign-in for staff

Staff can see many children's records. Make sure every staff account signs
in with a second factor:

- **Single sign-on** (Google, Microsoft, SAML or another OpenID Connect
  provider) with multi-factor authentication enforced **at the identity
  provider**. GradeBook does not see or check the provider's MFA, so enforce
  it there with a policy that covers every staff account.
- Or an **authenticator app (TOTP)** in GradeBook. The organisation setting
  *Require an authenticator app for admins and safeguarding roles* is on by
  default; it covers organisation admins, school admins and anyone holding
  the safeguarding permission, not every teacher. Ask other staff to turn it
  on themselves. See [Two-step verification](./guide/two-factor.md).

Staff sessions are shorter than other accounts' by default
(`STAFF_SESSION_IDLE_HOURS`, `STAFF_SESSION_MAX_DAYS`).

## Health, scaling, and operations

- Configure the API load balancer's health check as `GET /health`. A healthy
  response requires PostgreSQL and S3 to respond; Redis must respond when
  enabled. Redis being explicitly disabled is reported as acceptable.
- Allow time for startup migrations and the health check's 40-second
  `start_period` when using the repository's Compose configuration. Avoid
  routing traffic to an instance until it passes health checks.
- Use a process/container supervisor with restart-on-failure and graceful
  termination. Keep the API's shutdown period long enough to finish in-flight
  requests and close workers.
- Back up PostgreSQL and test restoration regularly. Production requires
  encrypted backups to a separate bucket; see
  [`infrastructure/BACKUPS.md`](../../infrastructure/BACKUPS.md).
- Monitor API health, latency, errors, memory, CPU, database connections and
  disk, Redis queue depth/memory, SMTP delivery, S3 failures, and backup
  success. Increase capacity based on observed behavior rather than a fixed
  user count.

## Production checklist

- [ ] Frontend and API have stable DNS names and valid HTTPS certificates.
- [ ] `DATABASE_URL` points to PostgreSQL 15+ and automated backups and restore
  procedures are in place.
- [ ] S3 bucket, credentials, public endpoint, and CORS are configured and
  tested from a real browser and mobile device.
- [ ] SMTP delivery is configured and a sign-in email has been received.
- [ ] Production secrets are set: `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`,
  `CHAT_ENCRYPTION_KEY`, and `STUDENT_CLAIM_CODE_PEPPER`, with offline copies
  of the encryption keys; development login is disabled.
- [ ] `DATABASE_URL` (and `BACKUP_DATABASE_URL`) use `sslmode=verify-full`
  for a remote database, and the API logs no TLS warning at startup.
- [ ] Database, Redis, bucket and log disks are encrypted at rest, and every
  store and backup bucket is in a region suitable for the schools (EU or UK
  for EU or UK schools).
- [ ] Staff sign in through single sign-on with MFA enforced at the identity
  provider, or with an authenticator app.
- [ ] `FRONTEND_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, and
  `NEXT_PUBLIC_STORAGE_URL` match the deployed origins.
- [ ] Redis is shared and enabled if running multiple API instances.
- [ ] `GET /health`, sign-in, file upload/download, and a live stream have been
  tested through the public proxy.
- [ ] Monitoring, restart behavior, migration strategy, backup alerts, and
  restore procedures are documented for the operator.

See also [`Developer Guide`](./developer-guide.md),
[`Environment Variables`](./environment-variables.md),
[`Backups`](./backups.md), and
[`Mobile in production`](./mobile-production.md).
