# Billing (`src/billing`)

This module is the SaaS billing for the **hosted** GradeBook platform. Each school has one subscription row. A row starts as a free trial, and when the trial runs out the school pays monthly on one of two plans:

- `per_user`: billed per billable user, which means active staff members plus active roster students;
- `flat`: one fixed price.

Payment goes through a pluggable **payment provider** (Stripe, PayPal, Paddle, WiPay or manual bank transfer). When a school's subscription lapses, the school becomes **read-only**: mutating requests from its members get a `402` with `code: 'SUBSCRIPTION_REQUIRED'`. A separate operator ("platform admin") dashboard shows every school, its invoices, and the switches that turn each provider on or off.

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
| GET | `/api/billing` | Summary: plan, status, read-only flag, trial and period end, provider, billable users, estimated amount, prices and the enabled providers. |
| POST | `/api/billing/checkout` | `CheckoutDto { plan, provider }`. **Subscription** providers start a provider checkout and return `{ redirectUrl }`. The plan and provider are saved right away, and the status changes when the provider's webhook arrives. **Invoice** providers save the plan, raise the first invoice (voiding an open invoice for a different plan) and return the provider's payment result (`redirectUrl` and/or `instructions`). Gives 409 when the school already has a live subscription with a subscription-mode provider. |
| POST | `/api/billing/change-plan` | `ChangePlanDto { plan }`. For a live subscription-mode subscription it calls `provider.changePlan()`. In invoice mode the next invoice uses the new plan. |
| POST | `/api/billing/cancel` | Cancels at the end of the period (`provider.cancel({ atPeriodEnd: true })` in subscription mode) and sets `cancel_at_period_end`. |
| POST | `/api/billing/resume` | Undoes a pending cancel (`provider.resume()`). |
| POST | `/api/billing/portal` | Returns `{ url }`, the provider-hosted page for managing payment methods, or `null` when the provider has none. |
| GET | `/api/billing/invoices` | The school's invoices, newest first. |
| POST | `/api/billing/invoices/:id/pay` | `PayInvoiceDto { provider }`. Pays an open invoice with an enabled invoice-mode provider. |

**`BillingWebhookController`** (`/api/billing/webhooks/:providerId`) is guarded by `BillingEnabledGuard` only. It is public, skips rate limiting and is hidden from Swagger. Trust comes from each provider verifying its signature over the exact raw body.

| Method | Path | What it does |
|--------|------|--------------|
| POST | `/api/billing/webhooks/:providerId` | A provider's server-to-server webhook. It calls `provider.parseWebhook()` and then `BillingEventsService.handle()`. A failed verification answers 400. Any other failure answers 500 so the provider retries. Success answers `{ received: true }`. An unknown or unconfigured provider answers 404. A POST that looks like it came from a browser (`Accept: text/html` or a form body) is handled like the GET below. |
| GET | `/api/billing/webhooks/:providerId` | A browser coming back from a hosted payment page (WiPay). The callback is applied, then the browser is redirected with a 302 to `APP_URL/dashboard/settings/billing?checkout=success` or `?checkout=cancel`. |

**`PlatformMeController`** is guarded by `BillingEnabledGuard` and `AuthGuard`.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/platform/me` | Returns `{ isPlatformAdmin }`. |

**`PlatformController`** is guarded by `BillingEnabledGuard`, `AuthGuard` and `PlatformAdminGuard`. Anyone who is not a platform admin gets a 404.

| Method | Path | What it does |
|--------|------|--------------|
| GET | `/api/platform/overview` | Counts by status, read-only count, MRR in cents, currency and open invoices. |
| GET | `/api/platform/schools?search=&status=` | Every school's billing row, filtered by name and/or display status. |
| GET | `/api/platform/schools/:schoolId` | One school, with its comp details, invoices and the last 100 payment events. |
| POST | `/api/platform/schools/:schoolId/extend-trial` | `ExtendTrialDto { days }`. Extends from the later of the trial end and now. |
| POST | `/api/platform/schools/:schoolId/comp` | `CompDto { until, note? }`. Gives the school free access until a date. |
| GET | `/api/platform/invoices?status=` | Up to 500 invoices with school names. `status` is one of `open`, `paid`, `void`, `uncollectible`. |
| POST | `/api/platform/invoices/generate` | Runs the invoice sweep now and returns `{ created }`. |
| POST | `/api/platform/invoices/:id/mark-paid` | `MarkPaidDto { method, reference?, note? }`. Records a payment made outside any provider. |
| POST | `/api/platform/invoices/:id/void` | `VoidInvoiceDto { note? }`. |
| GET | `/api/platform/providers` | Each registered provider with `allowedByEnv`, `configured` and `enabled`. |
| PATCH | `/api/platform/providers/:id` | `SetProviderDto { enabled }`. The dashboard switch. Turning a provider on gives 409 unless `PAYMENT_PROVIDERS` lists it and its credentials are set. |

### Services / exports

`BillingModule` exports `BillingRegistry` and `SubscriptionService`. It is not global.

- **`BillingRegistry`** (`billing.registry.ts`) holds every known `PaymentProvider`.
  - `find(id)` and `known(id)` look up a registered provider whether or not it is enabled.
  - `statuses()` reports, for each provider, the three switches that gate it.
  - `enabled()` and `getEnabled(id)` return only the providers a school may choose.
  - A provider is enabled when it is listed in `PAYMENT_PROVIDERS`, `isConfigured()` is true, and its `billing.provider_setting` row (if any) has `enabled = true`.
  - The provider list is injectable through `PAYMENT_PROVIDER_LIST`, which tests use.
- **`SubscriptionService`** manages each school's subscription row and what it entitles the school to.
  - `ensure(schoolId)` creates a trial row lazily. The trial ends `BILLING_TRIAL_DAYS` after the later of the school's creation date and now.
  - `ensureAll()` creates trial rows in bulk with SQL.
  - `expireCanceled()` ends subscriptions marked cancel-at-period-end whose period is over.
  - `entitlement(schoolId)` is cached for 60 seconds under `billing:ent:<schoolId>`. `evaluate()` computes it from a row without the cache.
  - `schoolOfUser(userId)` is cached for 60 seconds under `billing:user-school:<userId>`. For a student it is the roster school, otherwise the active school.
  - `oldestOpenDue()` and `invalidate()`.
- **`BillingService`**: the school-side logic behind `BillingController` and `/billing/status`.
- **`SeatService`**:
  - `countBillable(schoolId)` and `countAll()` count active staff with a membership in their active school, plus active `student.student` rows (students with no account still count).
  - `syncAll()`, called hourly, pushes changed seat counts to live `per_user` subscription-mode subscriptions via `provider.updateQuantity()`. There is no per-school sync: a change in a school's count reaches its provider on the next hourly tick.
- **`InvoiceService`**: our own invoices, numbered `GB-YYYYMM-<seq>` under a Postgres advisory lock.
  - `raise()` creates the next invoice: due in 14 days, covering one month from the paid-through date.
  - `sweep()` raises invoices for invoice-mode schools 7 days before their period or trial ends.
  - `applyPaid()`, `markPaidByProvider()`, `markPaid()` and `voidInvoice()`.
  - It also exports `invoiceDto()`, `numberPrefix()` and `formatNumber()`.
- **`BillingEventsService`**: `handle(provider, events)` applies normalised `BillingEvent`s to the subscription and invoice rows.
  - Each event is first recorded in `billing.payment_event`, keyed by `(provider, event_id)`, so retries and duplicate deliveries are skipped.
  - Stale out-of-order `subscription.updated` events are ignored, and an older event never revives a canceled subscription.
  - In subscription mode, `invoice.paid` is stored as a paid invoice for the school's history.
- **`PlatformService`**: the operator dashboard.
  - `isPlatformAdmin()` is true for users with a row in `billing.platform_admin`, or for a verified, non-disabled account whose email is listed in `PLATFORM_ADMIN_EMAILS`.
  - `overview`, `schools`, `school`, `extendTrial`, `comp`, invoice actions, `providers`, `setProvider`.
- **`BillingScheduler`**: runs once 30 seconds after boot, then every hour, in each instance. Only one instance runs a given tick, thanks to `pg_try_advisory_xact_lock('gradebook:billing:sweep')`. Each tick runs `ensureAll`, then `expireCanceled`, then `syncAll`, and the invoice sweep at most once a day. It does not run when `NODE_ENV=test` or when billing is off.

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
  - Invoice-mode schools lapse when an open invoice is `graceDays` past its due date.
  - The file also has `initialTrialEnd()`.
- `billing.config.ts`:
  - `loadBillingConfig()` reads the environment (see Configuration).
  - `billingEnabled()` is the cheap hot-path check.
  - Plan helpers: `planPrice`, `seatsFor`, `amountFor`, `isPlan`, `PLANS`.
  - Other helpers: `billingReturnUrl`, `addMonth`, `DAY_MS`, `csvSet`.
- `raw-body.ts`: `registerWebhookRawBody(fastify)` is called from `src/createApp.ts`.
  - On `/api/billing/webhooks/*` only, it keeps the exact request bytes on `request.rawBody`, which providers need to verify signatures, while still letting JSON and form bodies parse normally.
  - It accepts any content type on that path and answers 415 for unknown types everywhere else.
  - It also exports `WEBHOOK_PATH_PREFIX` and `isWebhookUrl`.
- [`providers/`](./providers/README.md) has the `PaymentProvider` interface and the five providers.

## Used by

- `src/app.module.ts` imports `BillingModule`. Because of the `APP_INTERCEPTOR`, the interceptor applies to every route in the app.
- `src/createApp.ts` calls `registerWebhookRawBody()` from `raw-body.ts`.
- `src/test/billing-fakes.ts` implements `PaymentProvider` (`FakeProvider`) for the billing tests.
- Frontend:
  - `app/dashboard/settings/billing/page.tsx` (all the `/billing` school-admin routes);
  - `app/platform/**` (overview, schools, school detail, invoices, providers, generate button);
  - `lib/billing.ts` and `lib/billing-types.ts` (`/billing/status`, `/platform/me`);
  - `lib/subscription-required.ts` and `lib/api.ts` (handle the 402 `SUBSCRIPTION_REQUIRED`);
  - `components/layout/app-sidebar.tsx` (the platform link).
- Mobile: `src/lib/billing.ts` (`/billing/status`), and `src/lib/subscription-required.ts`, `src/lib/api.ts` and `app/_layout.tsx` (the 402 handling).
- `backend/scripts/smoke.ts` exercises invoice pay, mark-paid and void, and the platform school routes.

## Depends on

- `AuthModule` (`AuthGuard`) and `PermissionModule` (`PermissionGuard`).
- `PrismaService` and `CacheService` (both global).
- `apiBase()` from `src/sso/sso.config.ts`, which builds the provider callback URL `API_URL/api/billing/webhooks/<id>`.
- `primaryOrigin()` from `src/config/origins.ts`, the fallback for `APP_URL`.
- `isUniqueViolation` from `src/common/db-values`.
- The `stripe` npm SDK, used by `StripeProvider` only. The other providers use `fetch`.

## Data

In the `billing` schema, defined in [`prisma/schema/billing.prisma`](../../prisma/schema/billing.prisma):

- `billing.subscription`: one row per school.
- `billing.invoice`
- `billing.payment_event`: the webhook idempotency log.
- `billing.provider_setting`: the dashboard switches.
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
| `PAYMENT_PROVIDERS` | empty (none) | Comma list of the provider ids this deployment may offer. |
| `PLATFORM_ADMIN_EMAILS` | empty | Comma list of verified account emails that count as platform admins. |
| `APP_URL` | `primaryOrigin()` | The web app origin for checkout return URLs. |
| `API_URL` | the request host, or `http://localhost:3001` | The public API origin for provider callback URLs (through `apiBase()`). |
| `NODE_ENV` | | `test` keeps the scheduler from starting. |

Each provider has its own variables, listed in [providers/README.md](./providers/README.md).

## Files

| File | Purpose |
|------|---------|
| `billing.module.ts` | Wires the controllers, the providers and the global interceptor. Exports `BillingRegistry` and `SubscriptionService`. |
| `billing.controller.ts` | `BillingStatusController` (`/billing/status`) and `BillingController` (school admin). |
| `billing-webhook.controller.ts` | Provider webhooks and hosted-page returns. |
| `platform.controller.ts` | `PlatformMeController` and `PlatformController` (operator dashboard). |
| `billing.service.ts` | School-side billing. |
| `subscription.service.ts` | Subscription rows, entitlement, user to school lookup. |
| `seat.service.ts` | Billable-user counts and seat sync. |
| `invoice.service.ts` | Invoice numbering, raising, the sweep, paying and voiding. |
| `billing-events.service.ts` | Applies normalised webhook events, idempotently. |
| `platform.service.ts` | Operator dashboard logic and the platform-admin check. |
| `billing.scheduler.ts` | The hourly and daily background sweeps, with an advisory lock. |
| `billing.registry.ts` | Provider registry and the enable switches. **Register new providers here.** |
| `billing.config.ts` | Environment config and price, seat and date helpers. |
| `billing.entitlement.ts` | The pure read-only and writable rule. |
| `billing.guards.ts` | `BillingEnabledGuard` and `PlatformAdminGuard`. |
| `billing.interceptor.ts` | The app-wide 402 interceptor. |
| `raw-body.ts` | Raw body capture for webhook routes. |
| `dto/` | Request bodies. See [dto/README.md](./dto/README.md). |
| `providers/` | Payment providers. See [providers/README.md](./providers/README.md). |
| `*.test.ts` | One test file per service or helper: `billing.service`, `billing-events.service`, `billing-webhook.controller`, `billing.config`, `billing.entitlement`, `billing.interceptor`, `billing.registry`, `billing.scheduler`, `invoice.service`, `platform.service`, `seat.service`, `subscription.service`. |

## Tests

```bash
cd backend && bun test src/billing
```

The tests use `createMockPrisma()` from `src/test/prisma-mock`, and `FakeProvider` plus the `subRow()` / `invoiceRow()` row builders from `src/test/billing-fakes.ts`. They cover:

- the entitlement rules (trial, subscription mode, invoice mode, comp);
- the interceptor's exemptions and its 402;
- registry gating by `PAYMENT_PROVIDERS`, credentials and switches;
- checkout, plan change, cancel, resume and portal;
- invoice numbering, raising, the sweep, mark-paid and void;
- webhook idempotency and event ordering;
- the webhook controller's 400, 500 and 404 answers and raw-body capture;
- seat counting and sync;
- the scheduler lock;
- platform-admin authorisation and the overview.

Each provider has its own tests in `providers/`.

## See also

- [docs/content/backend/billing.md](../../../docs/content/backend/billing.md)
- [docs/content/billing-providers.md](../../../docs/content/billing-providers.md) (provider setup)
- [docs/content/billing-staging.md](../../../docs/content/billing-staging.md)
- [providers/README.md](./providers/README.md) and [dto/README.md](./dto/README.md)
