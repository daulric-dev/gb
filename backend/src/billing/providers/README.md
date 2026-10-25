# Payment providers (`src/billing/providers`)

GradeBook takes payment through **one provider: Stripe**. Payment is Stripe-hosted: schools subscribe on Stripe Checkout and manage their card and invoices in the Stripe Customer Portal, so no card form is ever shown on our pages. There is no manual / bank-transfer option, and invoices cannot be marked paid by hand.

The rest of billing still only talks to the `PaymentProvider` interface (in `payment-provider.ts`) through `BillingRegistry` in `../billing.registry.ts`, and never imports `StripeProvider` directly. That keeps the door open to adding another provider later (see below) without touching the controllers, the DTOs or the database.

The provider runs the recurring billing itself: billing starts a subscription with `createCheckout`, keeps the seat count in step with `updateQuantity`, and learns about payments and status changes from signed webhooks (`parseWebhook`).

Money is always an integer number of minor units (cents) plus an ISO currency code.

## Files

| File | Defines |
|------|---------|
| `payment-provider.ts` | The `PaymentProvider` interface. The context and result types: `CheckoutContext`, `CheckoutResult`, `ProviderSubscriptionRef`, `WebhookRequest`, `PlanPrice`. The `BillingPlan` and `SubscriptionStatus` unions. The normalised `BillingEvent` union (`subscription.updated`, `subscription.canceled`, `invoice.paid`, `invoice.payment_failed`, `ignored`). And `WebhookVerificationError`, which the webhook controller answers with a 400. |
| `http.ts` | Small shared helpers: `FetchLike` and `ProviderOptions` (tests inject a `fetch` stub), `HTTP_TIMEOUT_MS` (15 seconds), `ProviderApiError`, `env()` / `requireEnv()` (trimmed environment variables) and `fromUnix()`. |
| `stripe.provider.ts` | `StripeProvider` (`id: 'stripe'`) on the official `stripe` SDK: Checkout Sessions in subscription mode, subscription item updates (seats, plan changes, cancel / resume at period end), Customer Portal sessions, and `Stripe-Signature` verification with a 300-second tolerance. It uses your own prices (`STRIPE_PRICE_PER_USER`, `STRIPE_PRICE_FLAT`) or inline prices on two stable products (`gradebook_per_user`, `gradebook_flat`) that it creates on first use. |
| `*.test.ts` | `stripe.provider.test.ts` (`isConfigured`, checkout, subscription changes, portal, webhook verification, event mapping against a stubbed `fetch`) and `http.test.ts`. |

## Configuration

Stripe is offered to schools when billing is on (`BILLING_ENABLED=true`) and its `isConfigured()` is true:

| Provider | Required | Optional |
|----------|----------|----------|
| `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `STRIPE_PRICE_PER_USER`, `STRIPE_PRICE_FLAT` (recurring monthly prices) |

There is no allowlist variable and no on/off switch in the platform dashboard: credentials present means offered. When billing is on and Stripe is not configured, the API logs a warning at startup, checkout answers 503 ("Payments are not configured yet"), and the billing page shows school admins a "contact support" notice instead of payment buttons.

The Stripe dashboard setup (webhook endpoint and events, Customer Portal, test mode, `stripe listen` for local development) is in [docs/content/billing-providers.md](../../../../docs/content/billing-providers.md).

## How the parent module uses providers

- `BillingRegistry` (`../billing.registry.ts`) builds the list with `defaultProviders()`. `enabled()` / `getEnabled(id)` return the configured ones; `find(id)` returns any registered one. An id that is not registered (such as `manual` on a row left from an older release) is simply unknown: the school is treated as having no provider and can subscribe again.
- `BillingService` calls `createCheckout`, `changePlan`, `cancel`, `resume` and `portalUrl`.
- `SeatService` calls `updateQuantity` from the hourly sync.
- `BillingWebhookController` hands `POST /api/billing/webhooks/<id>` requests to `parseWebhook`, with `rawBody` (the exact bytes, kept by `../raw-body.ts`), lower-cased `headers` and `query`, then passes the returned events to `BillingEventsService`.
- `BillingEventsService` matches events to schools by `(provider, providerSubscriptionId)` or by the `schoolId` taken from the metadata attached at checkout, and makes every event idempotent on `(provider, eventId)`. `invoice.paid` is stored as a paid invoice for the school's history.

## How to add another payment provider later

1. **Create `providers/<name>.provider.ts`** with a class that implements `PaymentProvider` from `./payment-provider`:
   - `readonly id`: a stable, lower-case id such as `'acme'`. It is stored on `billing.subscription.provider` and `billing.invoice.provider`, and appears in the webhook URL `/api/billing/webhooks/<id>`. Never change it once you have shipped it.
   - `readonly label`: shown to school admins.
   - `isConfigured()`: return true only when every required environment variable is present. Read them with `env()` from `./http`. The registry treats a throw as "not configured".
   - Take `options: ProviderOptions = {}` in the constructor and use `options.fetch ?? fetch` (or pass it to the provider's SDK) so tests can stub the network. Throw `ProviderApiError` for API failures and never put secrets in error messages.
2. **Implement the methods.** `createCheckout(ctx)` is required: send the browser to the provider's hosted page, put `ctx.schoolId` and `ctx.price.plan` into the provider's metadata so webhooks can be matched back to the school, and return `{ redirectUrl, providerRef, providerCustomerId }`. Use `ctx.idempotencyKey` if the provider supports one. Then `updateQuantity`, `changePlan`, `cancel({ atPeriodEnd })`, `resume`, and optionally `portalUrl`; billing answers 400 ("cannot …") when one it needs is missing.
3. **Implement `parseWebhook(req)`.**
   - Verify the signature over `req.rawBody` (the exact bytes) with the provider's secret, using a constant-time comparison.
   - On any failure, **throw `WebhookVerificationError`**. Never trust an unverified body.
   - Translate each provider event into a `BillingEvent`. Map the provider's statuses to `SubscriptionStatus`. Fill `eventId` with the provider's own event id, which is used for idempotency. Return `{ type: 'ignored', eventId, reason }` for event types you do not handle. Exposing a `mapEvent()` method helps tests, as `StripeProvider` does.
4. **Register it** in `defaultProviders()` in `../billing.registry.ts`. That is the only place in the app that lists providers.
5. **Update the registry test.** `../billing.registry.test.ts` asserts the exact list of ids returned by `defaultProviders()` (`['stripe']`).
6. **Write `providers/<name>.provider.test.ts`**, modelled on `stripe.provider.test.ts`. Then run `cd backend && bun test src/billing`.
7. **Choose how schools pick it.** With more than one provider configured, `GET /api/billing` lists them all in `providers` and `CheckoutDto.provider` selects one (it defaults to the first configured provider when omitted); the web billing page currently shows a single "Continue to payment" button, so it would need a provider choice. If you need per-deployment on/off control, the `billing.provider_setting` table is still in the schema (unused).
8. **Document the configuration**: add the variables, commented out, to `backend/.env.example` and `infrastructure/env.example`, to `docs/content/environment-variables.md`, and a section to `docs/content/billing-providers.md` and the table above. Point the provider's webhook at `https://<API_URL>/api/billing/webhooks/<id>`.
