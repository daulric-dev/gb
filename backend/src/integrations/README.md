# Integrations (`src/integrations`)

School webhooks: GradeBook POSTs platform events (grades and submissions, attendance, people and enrolment, courses and content) as signed JSON to URLs a school chooses, so its own systems can act on them. A school may have several webhooks, each with its own URL and event types. Behind the `integrations` feature (off by default: data leaves the platform). Full guide for receivers: [docs/content/backend/webhooks.md](../../../docs/content/backend/webhooks.md).

## What it provides

### HTTP routes

School admin (`school:update` + `AdminGuard`, the active school) under `/api/schools/current/webhooks`; organisation admins (`OrganisationAdminGuard`, any school, 404 for an unknown one) under `/api/organisation/schools/:schoolId/webhooks`. Both behind `FeatureGuard` + `@RequireFeature('integrations')` (403 `FEATURE_DISABLED`) and backed by one `WebhookService` that takes a school id.

| Method | Path (after the prefix) | Step-up | What it does |
| --- | --- | --- | --- |
| GET | `/` | | The school's webhooks; never the secret (`hasSecret`, `secretUnreadable`), with the last delivery, `insecure` (plain http) and `tls: { verify, caFingerprints }`. |
| POST | `/` | yes | Create: `{ name, url, events, enabled?, headers?, signingSecret?, tls?: { verify?, caCert? } }` → `{ webhook, secret, secretGenerated }`, the only time a generated secret is returned (`secret: null` when the school supplied its own). `events: ["*"]` is every current type except `ping`, stored expanded. |
| GET | `/:id` | | One webhook. |
| PATCH | `/:id` | yes | Any of `name`, `url`, `events`, `enabled`, `headers` (the full desired list `[{ id?, name, value? }]`: saved id + no value keeps, + value replaces, no id is new, missing ones are deleted), `tls: { verify?, caCert? }` (`''` clears the CA); switching on clears an auto-disable. |
| DELETE | `/:id` | yes | 204; deliveries cascade. |
| POST | `/:id/rotate-secret` | yes | Body optional `{ signingSecret? }`. New secret, effective immediately → `{ webhook, secret, secretGenerated }`. |
| POST | `/:id/test` | | Sends `ping` now (not retried, not counted); returns the delivery. Audited. |
| QUERY | `/:id/deliveries` | | Body `{ status?, eventType?, limit? (≤200), before? }`, newest first. |
| GET | `/deliveries/:deliveryId` | | Payload, response excerpt, attempts. |
| POST | `/deliveries/:deliveryId/redeliver` | | A new delivery with the same payload and event id, sent now. Audited. |
| QUERY | `/audit` | | The integrations activity log (`{ limit?, before? }`). |

Plus `GET /api/webhooks/event-types` (`WebhookEventTypesController`: any school admin or organisation admin; no school or feature needed): the event type catalog.

### Services / exports

The module is `@Global()` (`IntegrationsModule.forRoot()` in `app.module.ts`).

- **`WebhookEvents`** (import from `@/integrations/events`, the public barrel): `emit(schoolId, type, data | () => data)` and `emitForCourse(courseId, type, build)`, plus `student` / `staff` / `staffOrNull` / `studentOfUser` / `activity` reference loaders. Called after the owning change committed; returns at once, never throws into the caller. Stops after two cheap lookups when integrations are off for the school (cached feature map) or no enabled webhook subscribes to the type; only then is the payload built. Writes one `webhook_delivery` per subscribed webhook with one event id.
- `WebhookService` - the admin side (CRUD, secrets, test, deliveries, redeliver).
- `WebhookDeliveryService` - claiming, sending, retrying, auto-disable.
- `IntegrationAuditService` - `record(tx, ...)` and `list`.

### Where events are emitted

| Event | Emitted from |
| --- | --- |
| `submission.handed_in`, `quiz.completed`, `grade.recorded` (teacher mark, excuse) | `src/grading/submission.service.ts` |
| `grade.recorded` (CSV import, one per change) | `src/grading/gradebook-import.service.ts` |
| `activity.published` | `src/grading/activity.service.ts` |
| `attendance.session_opened`, `attendance.session_closed`, `attendance.recorded` | `src/attendance/attendance.service.ts` (`open`, `finalize` - only the call that closes it, `setRecord`, `checkIn`) |
| `course.created` | `src/course/course.service.ts` (`create`, and `announceCreated` from `course-copy.service.ts`) |
| `course.archived`, `student.enrolled` (staff, course code), `student.unenrolled` | `src/course/course.service.ts` |
| `student.joined_school` | `src/student-account/student-membership.service.ts` (join code), `src/email-domain/email-domain.service.ts` (student domain) |
| `student.left_school` | `src/student/student.service.ts` (an active student marked inactive) |
| `staff.joined` | `src/school/school.service.ts` (join request approved), `src/email-domain/email-domain.service.ts` (staff domain) |
| `staff.left` | `src/school/school.service.ts` (`leaveSchool`, `removeMember`) |
| `staff.role_changed` | `src/permission/permission.service.ts` (`changeMemberRole`) |
| `announcement.posted` | `src/announcement/announcement.service.ts` (school and course) |
| `ping` | `WebhookService.test` |

Not done: `grades.released` - there is no release step (a mark is visible once entered). Also not sent: custom role grants, school-admin appointments from the organisation console, per-student automatic absences at close (counted in `attendance.session_closed`).

## Delivery

The database is the queue. Each `webhook_delivery` row is `pending` with a `next_attempt_at`. A worker claims due rows with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING id`, which pushes `next_attempt_at` out by a 2-minute lease: instances never send one delivery at the same time, and a crashed instance's claim comes back.

- **Without Redis**: `WebhookWorker` polls every `WEBHOOK_POLL_INTERVAL_MS` (5 s) in every instance, and is kicked straight after an event is queued.
- **With Redis** (`USE_REDIS=true`, `REDIS_URL`): each new or rescheduled delivery is also a BullMQ job on `webhook-deliver` (delayed until due); `WebhookDeliverProcessor` claims it by id. The poller runs once a minute as a backstop.

Body (`events/webhook-envelope.ts`): exactly `{ event_type, message, data }` - `message` is the catalog type's plain-text sentence (`eventMessage`: ≤ 280 chars, whitespace collapsed, fallbacks like "A student"), `data` starts with `school: { id, name }` (added by `WebhookEvents.emit`). `webhook_delivery.payload` stores exactly that; a payload stored in the old `{ id, type, apiVersion, createdAt, school, data }` shape is converted by `toEnvelope` when retried (written back with the outcome) or redelivered. A send: POST, headers `Content-Type`, `User-Agent: GradeBook-Webhooks/1`, `X-GradeBook-Event`, `X-GradeBook-Event-Id` (from the row's `event_id`), `X-GradeBook-School-Id`, `X-GradeBook-Api-Version: 1`, `X-GradeBook-Delivery`, `X-GradeBook-Timestamp`, `X-GradeBook-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`; 10 s timeout; redirects not followed (3xx fails); at most 1 KB of the response read. Private, loopback, and reserved IPs are refused by default. Hostnames are resolved for each send, and the chosen public IP is pinned to the connection; `WEBHOOK_ALLOW_PRIVATE=true` opts into private-network destinations for trusted self-hosted integrations. 2xx succeeds. Failures retry after ~1 min, 5 min, 30 min, 2 h, 5 h, 8 h, 8 h (±20% jitter) - 8 attempts, about a day - then `abandoned`. Every failed attempt adds to the webhook's `consecutive_failures` (a success resets it); at `WEBHOOK_MAX_CONSECUTIVE_FAILURES` (50) it switches itself off (`disabled_reason`), logs `webhook_auto_disabled` and emails the school admin and organisation admins (same recipients as SSO alerts). Ordering is not guaranteed; receivers dedupe by event id.

Secrets: 32 random bytes (`whsec_` + base64url), or the school's own (16-256 printable ASCII, `customSecretProblem`), AES-256-GCM under an HKDF key from `AUTH_SECRET` (info `gradebook:webhook-secret:v1`) with the school and webhook id as AAD. A generated one is shown once (create, rotate); an own one is never echoed (`secret: null`); rotation is immediate.

TLS (`webhooks/webhook-tls.ts`): `school_webhook.verify_tls` (default true) and `tls_ca_cert` (normalised PEM bundle, `parseCaBundle`: X.509 certificates only via `crypto.X509Certificate`, ≤ 64 KB, private keys refused). On https the sender passes the certificate-verification and CA settings to its Node HTTPS transport (`fetchTlsOptions`; nothing for http). Each attempt records `webhook_delivery.tls_verified` (false = sent unverified, null = http). Turning verification off (create or PATCH, so step-up) is audited `tls_verification_disabled` and emails the same recipients as auto-disable (`WebhookAlertService.tlsVerificationDisabled`); back on is `tls_verification_enabled`; a CA change is `tls_ca_changed` with SHA-256 fingerprints before/after (never PEM). Responses carry `tls: { verify, caFingerprints }`.

Custom headers (`public.school_webhook_header`, `webhooks/webhook-headers.ts`): up to 20 `name: value` pairs per webhook sent with every attempt (events, retries, test, redeliver), for receivers that expect a key (`Authorization: Bearer ...`, `X-API-Key`). Names: letters, digits, `-`, at most 100, unique ignoring case; reserved `Content-Type`, `Content-Length`, `Host`, `User-Agent`, `Transfer-Encoding`, `Connection`, `X-GradeBook-*` (GradeBook's own headers also win in `webhookHeaders`). Values: 1-4096 printable ASCII, no CR/LF; each encrypted with its own HKDF info (`gradebook:webhook-header:v1`) and the school, webhook and header id as AAD. Write-only: responses carry names only; values are never logged, never audited (the log lists header names added / removed / renamed / value changed), never in alert emails, and are replaced by `[redacted]` in the stored response excerpt and error (`redactValues`; request headers are not stored).

## Depends on

`PrismaService`, `FeatureService`, `MailService`, `SsoAlertService.recipients` (alert recipients), `OrganisationService.requireSchool`, the step-up guard (`src/auth`), `@nestjs/bullmq` in Redis mode. Node's `http`, `https`, DNS and `crypto` APIs.

## Data

Tables in [`prisma/schema/integration.prisma`](../../prisma/schema/integration.prisma) (migrations `20261104100000_webhooks`, `20261105100000_webhook_auth`, `20261105110000_webhook_tls`): `school_webhook`, `school_webhook_header`, `webhook_delivery`, `integration_audit_log`. Deliveries older than `WEBHOOK_DELIVERY_RETENTION_DAYS` (30) are purged by `src/retention`; deleting a school cascades to all of them.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `WEBHOOK_MAX_ATTEMPTS` | `8` | Attempts per delivery before it is abandoned. |
| `WEBHOOK_MAX_CONSECUTIVE_FAILURES` | `50` | Failed attempts in a row before auto-disable. |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | `30` | Delivery retention (read by `src/retention`). |
| `WEBHOOK_POLL_INTERVAL_MS` | `5000` | Poll interval without Redis. |
| `USE_REDIS`, `REDIS_URL` | | BullMQ mode. |
| `AUTH_SECRET` | | Keys the secret encryption; changing it makes secrets unreadable (rotate them). |

## Files

Grouped by role. Each test file sits next to the file it tests.

| Folder / file | Purpose |
| --- | --- |
| `integrations.module.ts` | `IntegrationsModule.forRoot()`: global providers, the controllers, and the BullMQ queue + processor in Redis mode. |
| **`config/`** | |
| `config/webhook.config.ts` | Env settings, timeouts, lease, and the backoff schedule `backoffMs`. |
| `config/webhook.constants.ts` | The queue name and job type. |
| **`events/`** | The event types and emitting them. |
| `events/index.ts` | The public barrel for emitting services: `WebhookEvents`, ref helpers, event keys, `validateEventData`. |
| `events/webhook-event-types.ts` | **The catalog** - every type's key, group, label, description, `message(data)` wording (`eventMessage`), JSON Schema of `data` and example; `expandEvents` (`"*"`), a small schema validator. Used by the API, UI, docs and tests. **Add new event types here.** |
| `events/webhook-events.service.ts` | `WebhookEvents`. |
| `events/webhook-envelope.ts` | The body: `buildEnvelope`, `envelopeBody` (fixed key order), `toEnvelope` (old-shape conversion). |
| `events/webhook-emitters.test.ts` | Each wired service emits its event, and its data validates against the schema. |
| **`webhooks/`** | Managing webhooks. |
| `webhooks/webhook.service.ts` | `WebhookService` (shared by both consoles). |
| `webhooks/webhook-secret.ts` | Secret generation, own-secret validation, and encryption of signing secrets and header values. |
| `webhooks/webhook-headers.ts` | Custom header rules, `planHeaders` (keep / replace / add / delete from the full desired list), `redactValues`. |
| `webhooks/dto/webhook.dto.ts` | Request DTOs. |
| **`delivery/`** | Sending. |
| `delivery/webhook-delivery.service.ts` | Claim, send, retry, abandon, auto-disable; `sendNow` for test/redeliver. |
| `delivery/webhook-sender.ts` | Signing, headers and the HTTP POST (timeout, no redirects, 1 KB excerpt). |
| `delivery/webhook.worker.ts` | The database poller. |
| `delivery/webhook.processor.ts` | The BullMQ worker (Redis mode). |
| **`controllers/`** | `school-webhook.controller.ts` (`/schools/current/webhooks`, `/webhooks/event-types`), `organisation-webhook.controller.ts`. |
| **`audit/`** | `integration-audit.service.ts`: the activity log (drops secret-looking keys). |
| **`alerts/`** | `webhook-alert.service.ts` + `webhook-alert.email.ts`: the switched-off email. |

## Tests

```bash
cd backend && bun test src/integrations
```

Catalog (unique keys, examples validate, every example has `school` and a ≤ 280-char message, per-type wording and fallbacks, `*` expansion, validator), envelope (exactly three keys, old-shape conversion on retry and redeliver), TLS (CA bundle parsing and fingerprints, fetch options for verify on / off / CA / http, live Bun HTTPS server with an openssl self-signed cert: refused by default, accepted with its CA or with verification off; `tls_verified` recorded; disable audited + alerted; CA change audited by fingerprint), signature format and headers, sender (2xx, 3xx not followed, 5xx, 1 KB cap, timeout, network error), backoff schedule and jitter, delivery (success resets, retry scheduling, abandon after max attempts, auto-disable + audit + alert once, switched-off webhook / feature, unreadable secret, `sendNow`, claim by id, custom headers sent on attempts and test/redeliver, header values redacted from stored excerpts, unreadable header value), worker loop, secrets (encrypted, AAD-bound, shown once, never listed, rotate, own signing secret accepted / used for HMAC / not echoed, header values on their own key and AAD), headers (name rules and reserved names, value rules, keep / rename / replace / delete plan, limits, audit by name only), service (URL syntax with internal hosts, `*`, 404 for another school, update/delete audits, test, deliveries QUERY filters, redeliver), controllers (step-up only on config routes, feature guard 403, org 404, catalog access), `WebhookEvents` gating and never throwing, audit secret scrubbing, alert email, and emission (with schema-valid data) from the course, announcement, school, permission, student, join-code, activity, submission and attendance services (the email-domain join and CSV-import emitters are covered only by type checks). Retention purge: `src/retention/retention.service.test.ts`.
