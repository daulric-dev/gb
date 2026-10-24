---
sidebar_label: Billing
---

# Billing

**Location**: `backend/src/billing/`

SaaS billing for the hosted platform: schools pay GradeBook. Two plans, a free
trial, a grace period, and a read-only mode for schools whose subscription has
lapsed. Payment providers are pluggable; the operator picks which ones a
deployment offers. Provider setup is in [Billing providers](../billing-providers.md),
every variable in [Environment variables](../environment-variables.md#billing),
and the pre-launch walkthrough in the [staging checklist](../billing-staging.md).

> **Self-hosted deployments leave `BILLING_ENABLED` unset.** Billing is off by
> default: no trial, no read-only mode, no `402`s, the scheduler never starts,
> the entitlement check is a single env read, and every `/api/billing/*` and
> `/api/platform/*` route answers 404 - except `GET /api/billing/status`, which
> answers `{ enabled: false, ... }` so the web and mobile apps hide billing UI.

## Business rules

| | |
| --- | --- |
| **Plans** | `per_user`: `BILLING_PER_USER_CENTS` (500) × billable users per month. `flat`: `BILLING_FLAT_CENTS` (30000) per month, unlimited users, quantity 1. |
| **Billable user** | An active staff member whose active school is this one and who has a membership there, or an active student on the school's roster (with or without an account). At least 1 seat. |
| **Trial** | `BILLING_TRIAL_DAYS` (30) from `max(school created, now)` when the school's row is first created - so on the first deploy with billing on, existing schools get a full trial from that day. |
| **Grace** | `BILLING_GRACE_DAYS` (7) after a missed renewal / an overdue invoice before the school turns read-only. A cancellation or a trial end gets no grace. |
| **Read-only** | Reads work; mutations answer `402 { statusCode: 402, code: 'SUBSCRIPTION_REQUIRED', message }`. |
| **Complimentary** | A platform admin can comp a school until a date: active without payment. |

## Architecture

```
billing.config.ts        env -> BillingConfig (prices, trial, allowlist, admins, APP_URL)
billing.registry.ts      every PaymentProvider; enabled() = allowedByEnv ∧ isConfigured ∧ not switched off
billing.entitlement.ts   pure: subscription row (+ oldest open invoice) -> { status, readOnly }
subscription.service.ts  lazy rows, cached entitlement (60s, invalidated on every billing write), user -> school
seat.service.ts          billable counts, seat sync to subscription-mode providers
invoice.service.ts       numbering, raise, sweep, mark paid / void, applyPaid
billing-events.service.ts  webhook events -> rows (idempotent, out-of-order safe)
billing.service.ts       school admin API
platform.service.ts      operator API, platform-admin check
billing.interceptor.ts   global: 402 for mutations from read-only schools
billing.scheduler.ts     hourly / daily sweeps under a Postgres advisory lock
raw-body.ts              keeps the exact webhook bytes for signature checks
providers/               payment-provider.ts (the interface) + one file per provider
```

### Entitlement check

`BillingEntitlementInterceptor` is registered globally (`APP_INTERCEPTOR`). It is
an interceptor rather than a guard because Nest runs interceptors after every
guard, so by then the route's `AuthGuard` has put the user on the request.

1. `BILLING_ENABLED` off, non-HTTP, `GET`/`HEAD`/`OPTIONS`: pass.
2. Allowlisted paths pass: `/api/auth/*` (sign-in, sign-out, own profile),
   `/api/billing/*`, `/api/platform/*`, `/api/notifications/devices`, read
   markers (`.../read`, `.../read-all`, `.../mark-read`), `/health`.
3. No user, or a user without a school: not tied to a school, pass.
4. The user's school (a student's roster school, otherwise the staff
   member's active school; cached 60s) -> cached entitlement -> 402 if read-only.

### Status computation

`computeEntitlement` (pure, unit-tested) in order:

1. `comp_until` in the future -> `active`.
2. Invoice mode with an open invoice: read-only once `due_at + grace` passes
   (unless still in trial); `past_due` is shown once it is due. An open invoice
   not yet that late keeps a lapsed school writable, so a school can pay by
   transfer after its trial ends.
3. In the school's trial -> writable.
4. By stored status: `active` writable until `current_period_end + grace`
   (no grace with `cancel_at_period_end`); `past_due` until period end + grace;
   `canceled` until period end; provider-side `trialing` until period end;
   `unpaid` / `incomplete` read-only.

The API reports the stored status, or `read_only` once lapsed.

## Data model

Schema `billing` (`backend/prisma/schema/billing.prisma`, migration
`20261024100000_billing`). Statuses and plans are `text` with `CHECK`s.

| Table | Key columns |
| --- | --- |
| `subscription` | one per school (`school_id` unique): `plan`, `status` (`trialing`/`active`/`past_due`/`canceled`/`unpaid`/`incomplete`), `provider`, `provider_customer_id`, `provider_subscription_id` (unique per provider), `quantity`, `trial_ends_at`, `current_period_start/end`, `cancel_at_period_end`, `comp_until`, `comp_note` |
| `invoice` | `number` unique (`GB-YYYYMM-<seq>`), school, `plan`, `seats`, `amount_cents`, `currency`, `status` (`open`/`paid`/`void`/`uncollectible`), `provider`, `provider_invoice_id` (unique per provider), `period_start/end`, `due_at`, `paid_at`, `method`, `reference`, `note`, `marked_by` (account user). Partial unique `(school_id, period_start)` over our own non-void invoices: no double billing even with several API instances. |
| `payment_event` | `(provider, event_id)` unique - webhook idempotency; `type`, `school_id`, normalised `payload`, `processed_at`, `error` |
| `provider_setting` | `provider_id` pk, `enabled`, `updated_by`, `updated_at` (no row = on) |
| `platform_admin` | `user_id` unique (account user); plus `PLATFORM_ADMIN_EMAILS` (verified emails) |

Rows are created lazily: on a school's first billing-relevant request
(`SubscriptionService.ensure`) and by the hourly sweep for every school
without one (`ensureAll`, one `INSERT ... SELECT`).

## Lifecycles

### Subscription mode (Stripe, PayPal, Paddle)

```
trialing ──checkout──> (provider checkout page) ──webhook subscription.updated(active)──> active
active ──invoice.paid──> active (period moves on)
active ──invoice.payment_failed──> past_due ──grace──> read_only
active ──cancel (at period end)──> active + cancel_at_period_end ──period end──> canceled ──> read_only
active ──subscription.canceled──> canceled (writable until the paid period ends)
```

- Checkout records `plan`, `provider`, `quantity` (and the provider customer);
  the status changes only when the provider's webhook confirms it.
- Seats: the hourly sweep counts billable users and calls
  `provider.updateQuantity` for per-user subscriptions whose count changed
  (skipped while `cancel_at_period_end`). Checkout sends the current count.
- Cancel-at-period-end is ended by our hourly sweep too: PayPal only
  suspends billing and never ends the subscription itself.
- PayPal plan/quantity revisions may need the payer's approval; the adapter
  logs the approval link and returns (see [Billing providers](../billing-providers.md)).

### Invoice mode (WiPay, manual)

```
trialing ──checkout(plan, manual|wipay)──> invoice GB-YYYYMM-n open (due +14d) ──paid──> active, paid through period_end
active ──7 days before period end: sweep raises next invoice──> open ──paid──> period end + 1 month
open ──past due──> past_due (shown) ──+ grace──> read_only
```

- Checkout sets plan and provider, raises the first invoice now (voiding an
  open one on another plan) and returns the provider's pay result: a WiPay
  hosted-page redirect, or the manual bank-transfer instructions with the
  invoice number to quote.
- The sweep (daily, and `POST /platform/invoices/generate`) raises an invoice
  for each invoice-mode school whose paid-through date (or trial end) is
  within 7 days, never while one is open, never after `cancel_at_period_end`,
  and not while comped. Period = paid-through date (or now, if lapsed) + 1
  month; seats counted at issue time; due 14 days after issue.
- Paying (WiPay `invoice.paid` with our invoice id, or a platform admin's
  mark-paid) sets the subscription `active` with `current_period_end` = the
  invoice's period end (a late payment buys a month from now).
- Mark-paid: only `open`/`uncollectible` invoices (409 for paid or void).
  Void: only unpaid ones. A provider payment for a void invoice is logged
  for manual refund/reissue, not applied.

### Webhooks

`POST /api/billing/webhooks/:providerId` (and `GET`, for hosted-page returns).
Public; `raw-body.ts` keeps the exact request bytes for this route only (a
`preParsing` hook, so JSON and form bodies still parse normally; other
content types reach this route as a buffer and stay 415 elsewhere).

1. Unknown or unconfigured provider: 404.
2. `provider.parseWebhook({ rawBody, headers, query })`: a
   `WebhookVerificationError` answers 400; any other failure 500.
3. Each event: recorded in `payment_event` by `(provider, eventId)`; already
   processed -> skipped. Applied; failures are written to `error` and answer
   500 so the provider retries (a retry reprocesses the same row).
4. Unknown school: logged, recorded, 200.
5. Out-of-order delivery: a `subscription.updated` whose period ends before
   the one held is ignored; a canceled subscription is not revived by an
   older update; news about a superseded subscription (the school has a
   newer live one) is ignored; `subscription.canceled` only cancels the
   subscription the school holds.
6. Browser returns (`GET`, or a POST with `Accept: text/html` or a form body,
   as WiPay sends) are applied the same way and then redirected to
   `${APP_URL}/dashboard/settings/billing?checkout=success|cancel`.

### Scheduling

`BillingScheduler` follows the attendance sweep pattern: `setInterval` from
`onModuleInit` (not in tests, not with billing off), first tick 30 seconds
after boot, then hourly. Each tick takes `pg_try_advisory_xact_lock` so only
one API instance works at a time. Hourly: `ensureAll`, `expireCanceled`,
seat sync. Daily: the invoice sweep.

## HTTP API

All under `/api`, JSON camelCase.

**Any signed-in user**

| Route | Answer |
| --- | --- |
| `GET /billing/status` | `{ enabled, readOnly, status, trialEndsAt }` - answers with billing off too |
| `GET /platform/me` | `{ isPlatformAdmin }` (billing on only) |

**School admins** (`school:update` in their active school; held by admins)

| Route | Body | Answer |
| --- | --- | --- |
| `GET /billing` | | summary: `enabled, plan, status, readOnly, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd, provider, billableUsers, estimatedAmountCents, currency, prices { perUserCents, flatCents }, providers [{ id, label, mode }]` |
| `POST /billing/checkout` | `{ plan, provider }` | `{ redirectUrl, instructions? }`; 400 provider not offered, 409 already subscribed |
| `POST /billing/change-plan` | `{ plan }` | summary |
| `POST /billing/cancel` / `resume` | | summary; 409 nothing to cancel |
| `POST /billing/portal` | | `{ url }` (null when the provider has none) |
| `GET /billing/invoices` | | `[{ id, number, plan, seats, amountCents, currency, status, provider, periodStart, periodEnd, dueAt, paidAt, method }]` |
| `POST /billing/invoices/:id/pay` | `{ provider }` | `{ redirectUrl, instructions? }`; 404 not this school's, 409 not open |

**Platform admins** (404 for everyone else, and with billing off)

| Route | Body |
| --- | --- |
| `GET /platform/overview` | -> `{ schools, trialing, active, pastDue, readOnly, mrrCents, currency, openInvoices }` |
| `GET /platform/schools?search=&status=` | -> rows `{ schoolId, name, plan, status, readOnly, provider, billableUsers, trialEndsAt, currentPeriodEnd, openInvoices }` |
| `GET /platform/schools/:schoolId` | -> row + `compUntil, compNote, invoices, events [{ provider, type, createdAt }]` |
| `POST /platform/schools/:schoolId/extend-trial` | `{ days: 1..365 }` (added to the later of now and the trial end) |
| `POST /platform/schools/:schoolId/comp` | `{ until, note? }` |
| `GET /platform/invoices?status=` | -> invoices + `schoolId, schoolName` |
| `POST /platform/invoices/:id/mark-paid` | `{ method: bank_transfer\|cheque\|cash\|other, reference?, note? }` |
| `POST /platform/invoices/:id/void` | `{ note? }` |
| `POST /platform/invoices/generate` | -> `{ created }` |
| `GET /platform/providers` | -> `[{ id, label, mode, allowedByEnv, configured, enabled }]` |
| `PATCH /platform/providers/:id` | `{ enabled }`; 409 enabling one not allowed by env and configured |

## Adding a provider

1. Write `backend/src/billing/providers/<id>.provider.ts` implementing
   `PaymentProvider` (`payment-provider.ts`): `id`, `label`, `mode`
   (`subscription` or `invoice`), `isConfigured()` from its env vars, the
   operations its mode needs (`createCheckout`, `updateQuantity`, `changePlan`,
   `cancel`, `resume`, `portalUrl` for subscription mode; `payInvoice` for
   invoice mode) and `parseWebhook`, which **must** verify the raw body and
   throw `WebhookVerificationError` when it does not check out, and maps
   provider events to `BillingEvent`s (unknown types -> `ignored`). Attach our
   `schoolId` (subscription mode) or `invoiceId` (invoice mode) as metadata so
   events can be matched.
2. Register it in `defaultProviders()` in `billing.registry.ts`.
3. Document its env vars in `backend/.env.example`,
   `infrastructure/env.example`, [Environment variables](../environment-variables.md#billing)
   and [Billing providers](../billing-providers.md).
4. Add its id to `PAYMENT_PROVIDERS` where it should be offered and point the
   provider's webhooks at `${API_URL}/api/billing/webhooks/<id>`.

Nothing else in the app knows which providers exist.

## Tests

`bun test src/billing` covers config parsing, registry selection (env ×
configured × switch), entitlement (trial, grace, comp, cancel, invoice
lateness), the interceptor (off = no-op, reads, allowlist, 402 shape), seat
counting and sync, event application (idempotency, retries, out-of-order),
invoice numbering and sweep idempotency, mark-paid/void transitions, platform
admin authorisation, the webhook controller and raw-body capture, and the
manual provider. `bun run smoke` runs an end-to-end billing section when the
API reports billing on, and checks every billing route is 404 when it is off.
