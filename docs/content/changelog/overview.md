---
sidebar_label: Overview
sidebar_position: 1
---

# Changelog

Notable changes to the codebase, grouped by date.

Each entry below links to a dedicated page with the full writeup - what changed, why, what to deploy, and any behavior changes downstream consumers should know about.

## 2026-05-24

- [Critical security fixes](./2026-05-24/security-fixes.md) - five criticals from the repo audit: cross-school admin RLS bypass, `assignment_write` policy typo, IDOR in service-client endpoints, PDF upload arbitrary path, PDF download IDOR.
- [High-severity fixes](./2026-05-24/high-fixes.md) - follow-up batch: removed `schoolId` from profile-update DTO, school-scoped the `ClassTeacherGuard` admin bypass, added auth to `/calculations/student-*`, closed the first-admin race with a partial unique index, fixed avatar upload path injection, hardened nginx config.
- [Medium-severity fixes](./2026-05-24/medium-fixes.md) - third batch: per-email rate limit on OTP/account-delete, school-mismatch check on enrollment, search-input sanitization in student.service, `leaveSchool` clears stale join requests, removed unused `@supabase/supabase-js` from frontend, added CSP header to nginx.
- [Low-severity fixes](./2026-05-24/low-fixes.md) - final cleanup: `BulkGradeDto` payload bounds, removed `X-Server-Port` debug header, fixed `docker-compose.yml` nginx mount path, registered `@fastify/cookie` in the Cloudflare worker entrypoint, removed OTP-paste auto-submit, fixed double-decode on onboard/pending page.
- [Redis resilience against Upstash idle disconnects](./2026-05-24/redis-resilience.md) - `CacheService` swallows Redis errors and degrades gracefully; `RedisStore` keeps the connection alive with a 60s `PING`.
- [Infrastructure CI: Dockerfile & build workflow](./2026-05-24/infrastructure-ci.md) — added a multi-stage Dockerfile for the backend, fixed the compose build context, and replaced the validation-only CI with jobs that build images and smoke-test the full stack.
