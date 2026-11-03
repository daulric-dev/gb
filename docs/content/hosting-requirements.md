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
nginx; it does not deploy the frontend, Postgres, or S3. Use a managed database
and S3 provider, or provision those services separately. See
[`infrastructure/SERVICES.md`](../../infrastructure/SERVICES.md) for the
Compose details and service behavior.

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
  the internet.
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
- [ ] Production secrets are set: `AUTH_SECRET`, `CHAT_ENCRYPTION_KEY`, and
  `STUDENT_CLAIM_CODE_PEPPER`; development login is disabled.
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
