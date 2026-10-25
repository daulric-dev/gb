---
sidebar_label: Billing
---

# Billing

**Location**: `backend/src/billing/`

SaaS billing for the hosted platform: schools pay GradeBook. Two plans, a free
trial, a grace period, and a read-only mode for schools whose subscription has
lapsed. Payments go through **Stripe** only (Stripe Checkout to subscribe,
the Stripe Customer Portal for cards and invoices); the provider layer stays
pluggable so another one can be added later. Stripe setup is in [Billing providers](../billing-providers.md),
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
| **Grace** | `BILLING_GRACE_DAYS` (7) after a missed renewal before the school turns read-only. A cancellation or a trial end gets no grace. |
| **Read-only** | Reads work; mutations answer `402 { statusCode: 402, code: 'SUBSCRIPTION_REQUIRED', message }`. |
| **Complimentary** | A platform admin can comp a school until a date: active without payment. |

## Architecture

```
billing.config.ts        env -> BillingConfig (prices, trial, admins, APP_URL)
billing.registry.ts      every PaymentProvider (today: Stripe); enabled() = isConfigured(); startup warning if none
billing.entitlement.ts   pure: subscription row -> { status, readOnly }
subscription.service.ts  lazy rows, cached entitlement (60s, invalidated on every billing write), user -> school
seat.service.ts          billable counts, seat sync to the provider (Stripe quantity)
invoice.service.ts       invoice numbering for invoices recorded from Stripe webhooks
billing-events.service.ts  webhook events -> rows (idempotent, out-of-order safe)
billing.service.ts       school admin API
platform.service.ts      operator API, platform-admin check
billing.interceptor.ts   global: 402 for mutations from read-only schools
billing.scheduler.ts     hourly sweep under a Postgres advisory lock
raw-body.ts              keeps the exact webhook bytes for signature checks
providers/               payment-provider.ts (the interface) + stripe.provider.ts
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
2. In the school's trial -> writable.
3. By stored status: `active` writable until `current_period_end + grace`
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
| `invoice` | `number` unique (`GB-YYYYMM-<seq>`), school, `plan`, `seats`, `amount_cents`, `currency`, `status` (`open`/`paid`/`void`/`uncollectible`), `provider`, `provider_invoice_id` (unique per provider), `period_start/end`, `due_at`, `paid_at`, `method`, `reference`, `note`, `marked_by` (account user). Rows are recorded from Stripe's `invoice.paid` webhooks (`status = paid`, `provider_invoice_id` = Stripe's invoice id). Older rows from the removed invoice-mode providers may still be present and are only shown as history. |
| `payment_event` | `(provider, event_id)` unique - webhook idempotency; `type`, `school_id`, normalised `payload`, `processed_at`, `error` |
| `provider_setting` | `provider_id` pk, `enabled`, `updated_by`, `updated_at`. **No longer read** (it held the old per-provider switches); kept so no destructive migration was needed. |
| `platform_admin` | `user_id` unique (account user); plus `PLATFORM_ADMIN_EMAILS` (verified emails) |

Rows are created lazily: on a school's first billing-relevant request
(`SubscriptionService.ensure`) and by the hourly sweep for every school
without one (`ensureAll`, one `INSERT ... SELECT`).

## Lifecycles

### Subscription lifecycle

```
trialing ──checkout──> (Stripe Checkout) ──webhook subscription.updated(active)──> active
active ──invoice.paid──> active (period moves on; a paid invoice is recorded)
active ──invoice.payment_failed──> past_due ──grace──> read_only
active ──cancel (at period end)──> active + cancel_at_period_end ──period end──> canceled ──> read_only
active ──subscription.canceled──> canceled (writable until the paid period ends)
```

- Checkout records `plan`, `provider`, `quantity` (and the Stripe customer);
  the status changes only when Stripe's webhook confirms it.
- Seats: the hourly sweep counts billable users and calls
  `provider.updateQuantity` for per-user subscriptions whose count changed
  (skipped while `cancel_at_period_end`). Checkout sends the current count.
- Cancel-at-period-end is also ended by our hourly sweep once the period is
  over, in case the provider's own event is late.
- Invoices: Stripe raises and collects every invoice. Each `invoice.paid` is
  stored as a paid row numbered `GB-YYYYMM-<seq>` for the school's and the
  operator's history; the invoice PDF and receipt live in Stripe (Customer
  Portal). There is no void action: Stripe owns the invoices and we only
  record paid ones. Payments are online only; an operator cannot mark an
  invoice paid by hand (they can **comp** a school instead).
- A subscription row whose `provider` is no longer registered (for example
  `manual`, or any provider removed when billing went Stripe-only) is treated as
  having no provider: nothing is called on it, it is never a "live"
  subscription that blocks checkout, and the school can subscribe with
  Stripe.

### Webhooks

`POST /api/billing/webhooks/:providerId` (Stripe: `/api/billing/webhooks/stripe`).
Public; `raw-body.ts` keeps the exact request bytes for this route only (a
`preParsing` hook, so JSON bodies still parse normally) so the signature can
be checked over them.

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

### Scheduling

`BillingScheduler` follows the attendance sweep pattern: `setInterval` from
`onModuleInit` (not in tests, not with billing off), first tick 30 seconds
after boot, then hourly. Each tick takes `pg_try_advisory_xact_lock` so only
one API instance works at a time. Hourly: `ensureAll`, `expireCanceled`,
seat sync. There is no invoice sweep: Stripe raises invoices itself.

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
| `GET /billing` | | summary: `enabled, plan, status, readOnly, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd, provider, billableUsers, estimatedAmountCents, currency, prices { perUserCents, flatCents }, providers [{ id, label }], paymentsConfigured` (`providers` is empty and `paymentsConfigured` false when Stripe is not configured) |
| `POST /billing/checkout` | `{ plan, provider? }` (`provider` defaults to `stripe`, the only one) | `{ redirectUrl }` (Stripe Checkout); 503 payments not configured, 400 unknown provider, 409 already subscribed |
| `POST /billing/change-plan` | `{ plan }` | summary |
| `POST /billing/cancel` / `resume` | | summary; 409 nothing to cancel |
| `POST /billing/portal` | | `{ url }`: a Stripe Customer Portal session (null when the school has no Stripe subscription) |
| `GET /billing/invoices` | | `[{ id, number, plan, seats, amountCents, currency, status, provider, periodStart, periodEnd, dueAt, paidAt, method }]` |

**Platform admins** (404 for everyone else, and with billing off)

| Route | Body |
| --- | --- |
| `GET /platform/overview` | -> `{ schools, trialing, active, pastDue, readOnly, mrrCents, currency, paymentsConfigured }` |
| `GET /platform/schools?search=&status=` | -> rows `{ schoolId, name, plan, status, readOnly, provider, billableUsers, trialEndsAt, currentPeriodEnd }` |
| `GET /platform/schools/:schoolId` | -> row + `compUntil, compNote, invoices, events [{ provider, type, createdAt }]` |
| `POST /platform/schools/:schoolId/extend-trial` | `{ days: 1..365 }` (added to the later of now and the trial end) |
| `POST /platform/schools/:schoolId/comp` | `{ until, note? }` |
| `GET /platform/invoices?status=` | -> invoices + `schoolId, schoolName` |

## Adding a provider

Stripe is the only provider today, but the seam is kept:

1. Write `backend/src/billing/providers/<id>.provider.ts` implementing
   `PaymentProvider` (`payment-provider.ts`): `id`, `label`,
   `isConfigured()` from its env vars, `createCheckout`, `updateQuantity`,
   `changePlan`, `cancel`, `resume`, `portalUrl`, and `parseWebhook`, which
   **must** verify the raw body and throw `WebhookVerificationError` when it
   does not check out, and maps provider events to `BillingEvent`s (unknown
   types -> `ignored`). Attach our `schoolId` as metadata so events can be
   matched to a school.
2. Register it in `defaultProviders()` in `billing.registry.ts`. It is
   offered as soon as `isConfigured()` is true.
3. Document its env vars in `backend/.env.example`,
   `infrastructure/env.example`, [Environment variables](../environment-variables.md#billing)
   and [Billing providers](../billing-providers.md), and point its webhooks
   at `${API_URL}/api/billing/webhooks/<id>`.
4. With more than one provider configured, the school billing page needs a
   provider choice again (checkout already accepts `provider`).

## Tests

`bun test src/billing` covers config parsing, registry selection (configured
or not), entitlement (trial, grace, comp, cancel), the interceptor (off = no-op, reads, allowlist, 402 shape), seat
counting and sync, event application (idempotency, retries, out-of-order),
invoice numbering, platform admin authorisation, the webhook controller and
raw-body capture, and the Stripe provider. `bun run smoke` runs a billing section when the API reports
billing on (school and platform routes, read-only mode and its recovery,
and that checkout answers 503 while Stripe is not configured), and checks every
billing route is 404 when it is off.
