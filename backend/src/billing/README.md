# Billing (`src/billing`)

Setting up Stripe (keys, prices, webhook, Customer Portal, local testing, go-live): [`STRIPE.md`](./STRIPE.md).

This module is the SaaS billing for the **hosted** GradeBook platform. Each school has one subscription row. A row starts as a free trial, and when the trial runs out the school pays monthly on one of two plans:

- `per_user`: billed per billable user, which means active staff members plus active roster students;
- `flat`: one fixed price.

Payment goes through **Stripe**, the one payment provider, behind the pluggable `PaymentProvider` interface. Payment is Stripe-hosted: Stripe Checkout to subscribe, the Stripe Customer Portal to manage the card and invoices; no card form appears on our pages. There is no bank-transfer / manual option, and an operator cannot mark an invoice paid by hand. When a school's subscription lapses, the school becomes **read-only**: mutating requests from its members get a `402` with `code: 'SUBSCRIPTION_REQUIRED'`. A separate operator ("platform admin") dashboard shows every school and its invoices.

**Billing does nothing unless `BILLING_ENABLED=true`.** Without it:

- every `/api/billing/*` and `/api/platform/*` route answers 404, except `GET /api/billing/status`;
- the scheduler never starts;
- the entitlement interceptor returns straight away.

Self-hosted deployments leave it off.

## What it provides

### HTTP routes

**`BillingStatusController`** is guarded by `AuthGuard` and is available on every deployment.

| Method | Path | Guard | What it does |
|--------|------|-------|--------------|
| GET | `/api/billing/status` | `AuthGuard` | Returns `{ enabled, readOnly, status, trialEndsAt }` for the caller's school. When billing is off it returns `enabled: false`, which the apps use to hide the billing UI. |

**`BillingController`** is guarded by `BillingEnabledGuard`, `AuthGuard`, `PermissionGuard` and `@RequirePermission('school', 'update')`, so it is for school admins. Everything applies to the caller's active school.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/billing` | Summary: plan, status, read-only flag, trial and period end, provider, billable users, estimated amount, prices, the configured providers (`[{ id, label }]`) and `paymentsConfigured` (false while billing is on but Stripe has no credentials). |
| POST | `/api/billing/checkout` | `CheckoutDto { plan, provider? }`. Starts a Stripe Checkout session (subscription mode) and returns `{ redirectUrl }`. The plan and provider are saved right away, and the status changes when Stripe's webhook arrives. `provider` defaults to the configured provider. 503 when no provider is configured, 400 for an unknown or unconfigured provider id, 409 when the school already has a live subscription. |
| POST | `/api/billing/change-plan` | `ChangePlanDto { plan }`. For a live subscription it calls `provider.changePlan()`; otherwise the plan is remembered for the next checkout. |
| POST | `/api/billing/cancel` | Cancels at the end of the period (`provider.cancel({ atPeriodEnd: true })`) and sets `cancel_at_period_end`. |
| POST | `/api/billing/resume` | Undoes a pending cancel (`provider.resume()`). |
| POST | `/api/billing/portal` | Returns `{ url }`, a Stripe Customer Portal session for the payment method and invoice history, or `null` when the school has no Stripe subscription. |
| GET | `/api/billing/invoices` | The school's invoices (recorded from Stripe `invoice.paid` webhooks), newest first. |

**`BillingWebhookController`** (`/api/billing/webhooks/:providerId`) is guarded by `BillingEnabledGuard` only. It is public, skips rate limiting and is hidden from Swagger. Trust comes from each provider verifying its signature over the exact raw body.

| Method | Path | What it does |
|--------|------|--------------|
| POST | `/api/billing/webhooks/:providerId` | A provider's server-to-server webhook (`/api/billing/webhooks/stripe`). It calls `provider.parseWebhook()` and then `BillingEventsService.handle()`. A failed verification answers 400. Any other failure answers 500 so the provider retries. Success answers `{ received: true }`. An unknown or unconfigured provider answers 404. |

**`PlatformMeController`** is guarded by `BillingEnabledGuard` and `AuthGuard`.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/platform/me` | Returns `{ isPlatformAdmin }`. |

**`PlatformController`** is guarded by `BillingEnabledGuard`, `AuthGuard` and `PlatformAdminGuard`. Anyone who is not a platform admin gets a 404.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/platform/overview` | Counts by status, read-only count, MRR in cents, currency, and `paymentsConfigured`. |
| GET | `/api/platform/schools?search=&status=` | Every school's billing row, filtered by name and/or display status. |
| GET | `/api/platform/schools/:schoolId` | One school, with its comp details, invoices and the last 100 payment events. |
| POST | `/api/platform/schools/:schoolId/extend-trial` | `ExtendTrialDto { days }`. Extends from the later of the trial end and now. |
| POST | `/api/platform/schools/:schoolId/comp` | `CompDto { until, note? }`. Gives the school free access until a date. |
| GET | `/api/platform/invoices?status=` | Up to 500 invoices with school names. `status` is one of `open`, `paid`, `void`, `uncollectible`. |

There is no void action: Stripe owns the invoices and we only record paid ones, so there is nothing of ours to void (refunds and voids are done in the Stripe dashboard).

### Services / exports

`BillingModule` exports `BillingRegistry` and `SubscriptionService`. It is not global.

- **`BillingRegistry`** (`providers/billing.registry.ts`) holds every known `PaymentProvider` (today only Stripe).
  - `find(id)` looks up a registered provider whether or not it is configured. An unregistered id (such as `manual` on an old row) is `undefined` and treated as "no provider".
  - `enabled()` and `getEnabled(id)` return only configured providers (`isConfigured()` true; a throw counts as false).
  - On startup it logs a warning when billing is on and no provider is configured.
  - The provider list is injectable through `PAYMENT_PROVIDER_LIST`, which tests use.
- **`SubscriptionService`** manages each school's subscription row and what it entitles the school to.
  - `ensure(schoolId)` creates a trial row lazily. The trial ends `BILLING_TRIAL_DAYS` after the later of the school's creation date and now.
  - `ensureAll()` creates trial rows in bulk with SQL.
  - `expireCanceled()` ends subscriptions marked cancel-at-period-end whose period is over.
  - `entitlement(schoolId)` is cached for 60 seconds under `billing:ent:<schoolId>`. `evaluate()` computes it from a row without the cache.
  - `schoolOfUser(userId)` is cached for 60 seconds under `billing:user-school:<userId>`. For a student it is the roster school, otherwise the active school.
  - `invalidate()`.
- **`BillingService`**: the school-side logic behind `BillingController` and `/billing/status`.
- **`SeatService`**:
  - `countBillable(schoolId)` and `countAll()` count active staff with a membership in their active school, plus active `student.student` rows (students with no account still count).
  - `syncAll()`, called hourly, pushes changed seat counts to live `per_user` subscriptions via `provider.updateQuantity()`. There is no per-school sync: a change in a school's count reaches its provider on the next hourly tick.
- **`InvoiceService`**: `createNumbered()` stores a copy of a Stripe invoice reported paid, numbered `GB-YYYYMM-<seq>` under a Postgres advisory lock. It also exports `invoiceDto()`, `numberPrefix()` and `formatNumber()`. Stripe's own invoice and PDF are in the Customer Portal; no hosted-invoice URL is stored (those links can expire, and the portal lists them all).
- **`BillingEventsService`**: `handle(provider, events)` applies normalised `BillingEvent`s to the subscription and invoice rows.
  - Each event is first recorded in `billing.payment_event`, keyed by `(provider, event_id)`, so retries and duplicate deliveries are skipped.
  - Stale out-of-order `subscription.updated` events are ignored, and an older event never revives a canceled subscription.
  - `invoice.paid` is stored as a paid invoice for the school's history; `invoice.payment_failed` moves an active subscription to `past_due`.
- **`PlatformService`**: the operator dashboard.
  - `isPlatformAdmin()` is true for users with a row in `billing.platform_admin`, or for a verified, non-disabled account whose email is listed in `PLATFORM_ADMIN_EMAILS`.
  - `overview`, `schools`, `school`, `extendTrial`, `comp`, `listInvoices`.
- **`BillingScheduler`**: runs once 30 seconds after boot, then every hour, in each instance. Only one instance runs a given tick, thanks to `pg_try_advisory_xact_lock('gradebook:billing:sweep')`. Each tick runs `ensureAll`, then `expireCanceled`, then `syncAll`. It does not run when `NODE_ENV=test` or when billing is off.

### Guards, interceptor and helpers

- `billing.guards.ts`:
  - `BillingEnabledGuard` answers 404 when billing is off, before authentication.
  - `PlatformAdminGuard` answers 404 for anyone who is not a platform admin. It must run after `AuthGuard`.
- `billing.interceptor.ts`: `BillingEntitlementInterceptor` is registered app-wide as `APP_INTERCEPTOR`. It runs after the route guards, so `req.user` is set by then.
  - It refuses mutating requests with a 402 when the caller's school is read-only.
  - Exempt: `GET`, `HEAD` and `OPTIONS` requests; `/api/auth/`, `/api/billing/`, `/api/platform/`, `/api/notifications/devices` and `/health`; any path ending in `/read`, `/read-all` or `/mark-read`; and requests with no user.
  - It also exports `isExempt()`, `subscriptionRequired()` and `SUBSCRIPTION_REQUIRED`.
- `billing.entitlement.ts`: `computeEntitlement()` is the pure rule for "may this school write?".
  - Comp access and the school's own trial always allow writes.
  - A paid period allows writes until it ends, plus `BILLING_GRACE_DAYS` for a missed renewal. A cancellation gets no grace.
  - The file also has `initialTrialEnd()`.
- `config/billing.config.ts`:
  - `loadBillingConfig()` reads the environment (see Configuration).
  - `billingEnabled()` is the cheap hot-path check.
  - Plan helpers: `planPrice`, `seatsFor`, `amountFor`, `isPlan`, `PLANS`.
  - Other helpers: `billingReturnUrl`, `addMonth`, `DAY_MS`, `csvSet`.
- `raw-body.ts`: `registerWebhookRawBody(fastify)` is called from `src/createApp.ts`.
  - On `/api/billing/webhooks/*` only, it keeps the exact request bytes on `request.rawBody`, which Stripe's signature check needs, while still letting JSON bodies parse normally.
  - It accepts any content type on that path and answers 415 for unknown types everywhere else.
  - It also exports `WEBHOOK_PATH_PREFIX` and `isWebhookUrl`.
- [`providers/`](./providers/README.md) has the `PaymentProvider` interface and `StripeProvider`.

## Used by

- `src/app.module.ts` imports `BillingModule`. Because of the `APP_INTERCEPTOR`, the interceptor applies to every route in the app.
- `src/createApp.ts` calls `registerWebhookRawBody()` from `raw-body.ts`.
- `src/test/billing-fakes.ts` implements `PaymentProvider` (`FakeProvider`) for the billing tests.
- Frontend:
  - `app/dashboard/settings/billing/page.tsx` (all the `/billing` school-admin routes);
  - `app/platform/**` (overview, schools, school detail, invoices);
  - `lib/billing.ts` and `lib/billing-types.ts` (`/billing/status`, `/platform/me`);
  - `lib/subscription-required.ts` and `lib/api.ts` (handle the 402 `SUBSCRIPTION_REQUIRED`);
  - `components/layout/app-sidebar.tsx` (the platform link).
- Mobile: `src/lib/billing.ts` (`/billing/status`), and `src/lib/subscription-required.ts`, `src/lib/api.ts` and `app/_layout.tsx` (the 402 handling).
- `backend/scripts/smoke.ts` exercises the school billing routes (checkout answers 503 when Stripe is not configured, removed providers are refused), that the removed invoice-mode, void and provider routes are gone, read-only mode with recovery by extend-trial and comp, and the platform overview, school and invoice routes.

## Depends on

- `AuthModule` (`AuthGuard`) and `PermissionModule` (`PermissionGuard`).
- `PrismaService` and `CacheService` (both global).
- `primaryOrigin()` from `src/config/origins.ts`, the fallback for `APP_URL`.
- `isUniqueViolation` from `src/common/db-values`.
- The `stripe` npm SDK, used by `StripeProvider` only.

## Data

In the `billing` schema, defined in [`prisma/schema/billing.prisma`](../../prisma/schema/billing.prisma):

- `billing.subscription`: one row per school.
- `billing.invoice`
- `billing.payment_event`: the webhook idempotency log.
- `billing.provider_setting`: no longer read (the provider switches were removed); kept in place, no destructive migration.
- `billing.platform_admin`

The module also reads `public.school`, `public.user_profile`, `public.school_management`, `student.student` and `account.app_user`.

## Configuration

| Variable | Default | Used for |
|----------|---------|----------|
| `BILLING_ENABLED` | off | `1`, `true`, `yes` or `on` turns billing on. |
| `BILLING_PER_USER_CENTS` | `500` | Monthly price per seat, in minor units. |
| `BILLING_FLAT_CENTS` | `30000` | Monthly flat price. |
| `BILLING_CURRENCY` | `USD` | A 3-letter ISO code. Anything else falls back to USD. |
| `BILLING_TRIAL_DAYS` | `30` | Trial length for new rows. |
| `BILLING_GRACE_DAYS` | `7` | Grace after a missed renewal or an overdue invoice. |
| `PLATFORM_ADMIN_EMAILS` | empty | Comma list of verified account emails that count as platform admins. |
| `APP_URL` | `primaryOrigin()` | The web app origin for checkout return URLs. |
| `NODE_ENV` | | `test` keeps the scheduler from starting. |

Stripe's variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PRICE_PER_USER` / `STRIPE_PRICE_FLAT`) are listed in [providers/README.md](./providers/README.md).

## Files

Grouped by role. Each test file sits next to the file it tests.

| Folder / file | Purpose |
|------|---------|
| `billing.module.ts` | Wires the controllers, the providers and the global interceptor. Exports `BillingRegistry` and `SubscriptionService`. |
| [`STRIPE.md`](./STRIPE.md) | Setting up Stripe: keys, prices, webhook (local and production), Customer Portal, go-live. |
| **`school/`** | The school admin API. |
| `school/billing.controller.ts` | `BillingStatusController` (`/billing/status`) and `BillingController` (school admin). |
| `school/billing.service.ts` | School-side billing: summary, checkout, plan change, cancel/resume, portal, invoices. |
| **`platform/`** | The operator (developer) dashboard API. |
| `platform/platform.controller.ts` | `PlatformMeController` and `PlatformController`. |
| `platform/platform.service.ts` | Operator dashboard logic and the platform-admin check. |
| **`webhooks/`** | Receiving and applying provider events. |
| `webhooks/billing-webhook.controller.ts` | Provider webhooks (raw-body JSON POSTs). |
| `webhooks/billing-events.service.ts` | Applies normalised webhook events, idempotently and out-of-order safe. |
| `webhooks/raw-body.ts` | Raw body capture for the webhook routes (registered in `createApp.ts`). |
| **`subscriptions/`** | The billing state of each school. |
| `subscriptions/subscription.service.ts` | Subscription rows, cached entitlement, user to school lookup. |
| `subscriptions/billing.entitlement.ts` | The pure read-only / writable rule. |
| `subscriptions/seat.service.ts` | Billable-user counts and seat sync. |
| `subscriptions/invoice.service.ts` | Invoice numbering for the paid invoices recorded from Stripe, and the invoice DTO. |
| **`access/`** | Enforcement. |
| `access/billing.interceptor.ts` | The app-wide 402 interceptor (read-only schools). |
| `access/billing.guards.ts` | `BillingEnabledGuard` and `PlatformAdminGuard`. |
| **`jobs/`** | `billing.scheduler.ts`: the hourly background sweep, under a Postgres advisory lock. |
| **`config/`** | `billing.config.ts`: environment config and price, seat and date helpers. |
| **`providers/`** | Payment providers: the `PaymentProvider` interface, the Stripe adapter, and `billing.registry.ts` (**register new providers here**). See [providers/README.md](./providers/README.md). |
| **`dto/`** | Request bodies. See [dto/README.md](./dto/README.md). |

## Tests

```bash
cd backend && bun test src/billing
```

The tests use `createMockPrisma()` from `src/test/prisma-mock`, and `FakeProvider` plus the `subRow()` / `invoiceRow()` row builders from `src/test/billing-fakes.ts`. They cover:

- the entitlement rules (trial, subscription, comp, legacy rows);
- the interceptor's exemptions and its 402;
- registry gating by credentials and the startup warning;
- checkout (including 503 when nothing is configured and re-subscribing a row left by a removed provider), plan change, cancel, resume and portal;
- invoice numbering;
- webhook idempotency and event ordering;
- the webhook controller's 400, 500 and 404 answers and raw-body capture;
- seat counting and sync;
- the scheduler lock;
- platform-admin authorisation and the overview.

Stripe has its own tests in `providers/`.

## See also

- [docs/content/backend/billing.md](../../../docs/content/backend/billing.md)
- [docs/content/billing-providers.md](../../../docs/content/billing-providers.md) (Stripe setup)
- [docs/content/billing-staging.md](../../../docs/content/billing-staging.md)
- [providers/README.md](./providers/README.md) and [dto/README.md](./dto/README.md)
