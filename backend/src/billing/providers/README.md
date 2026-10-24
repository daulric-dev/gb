# Payment providers (`src/billing/providers`)

Each payment provider implements one interface, `PaymentProvider` (in `payment-provider.ts`). The rest of billing only talks to that interface: it reaches providers through `BillingRegistry` in `../billing.registry.ts` and never imports a concrete provider class. To add a provider, you write one class here and register it in that one list.

There are two kinds of provider (`mode`):

- **`subscription`**: the provider runs the recurring billing itself. Billing starts a subscription with `createCheckout`, keeps the seat count in step with `updateQuantity`, and learns about payments and status changes from webhooks (`parseWebhook`). Stripe, PayPal and Paddle work this way.
- **`invoice`**: GradeBook raises an invoice every month (`InvoiceService`) and the provider only collects that one payment (`payInvoice`), or collects nothing at all. WiPay (a hosted card page) and manual (bank transfer, marked paid by a platform admin) work this way.

Money is always an integer number of minor units (cents) plus an ISO currency code.

## Files

| File | Defines |
|------|---------|
| `payment-provider.ts` | The `PaymentProvider` interface. The context and result types: `CheckoutContext`, `InvoicePaymentContext`, `CheckoutResult`, `ProviderSubscriptionRef`, `WebhookRequest`, `PlanPrice`. The `BillingPlan` and `SubscriptionStatus` unions. The normalised `BillingEvent` union (`subscription.updated`, `subscription.canceled`, `invoice.paid`, `invoice.payment_failed`, `ignored`). And `WebhookVerificationError`, which the webhook controller answers with a 400. |
| `http.ts` | Helpers shared by the providers. `FetchLike` and `ProviderOptions` (tests inject a `fetch` stub). `send()` is fetch with a 15-second timeout (`HTTP_TIMEOUT_MS`) that throws `ProviderApiError`. `readJson()`. `env()` and `requireEnv()` read trimmed environment variables. `centsToDecimal()` and `decimalToCents()` convert money without floats and know which currencies have no minor unit. Plus `safeEqual()` (constant-time comparison), `fromUnix()`, `fromIso()` and `header()`. |
| `stripe.provider.ts` | `StripeProvider` (`id: 'stripe'`, subscription mode) on the official `stripe` SDK: Checkout Sessions, subscription item updates, the Billing customer portal, and `Stripe-Signature` verification with a 300-second tolerance. It uses your own prices (`STRIPE_PRICE_PER_USER`, `STRIPE_PRICE_FLAT`) or inline prices on two stable products (`gradebook_per_user`, `gradebook_flat`) that it creates on first use. |
| `paypal.provider.ts` | `PayPalProvider` (`id: 'paypal'`, subscription mode) over the REST API. It caches the OAuth token and finds or creates a catalog product and plans. Webhooks are verified through PayPal's `verify-webhook-signature` endpoint. PayPal cannot cancel at the end of a period, so `cancel({ atPeriodEnd: true })` **suspends** the subscription (see `PAYPAL_CANCEL_AT_PERIOD_END_NOTE`). Plan and quantity changes may need the payer's approval. `portalUrl` always returns `null`, because PayPal has no customer portal. |
| `paddle.provider.ts` | `PaddleProvider` (`id: 'paddle'`, subscription mode) for Paddle Billing over REST. Checkout is a transaction whose `checkout.url` is the account's default payment link. Webhooks are verified with `Paddle-Signature` (`ts` plus `h1` = HMAC-SHA256 of `ts:rawBody`, any `h1` may match, 300-second tolerance). It uses catalog prices or inline non-catalog prices. |
| `wipay.provider.ts` | `WiPayProvider` (`id: 'wipay'`, invoice mode), the WiPay hosted payment page for the Caribbean (TT, JM, BB). `payInvoice` creates a payment request. WiPay then sends the **browser** back to `callbackUrl` (the GET webhook route). `parseWebhook` checks our own HMAC (`gb_sig`) over the invoice, amount, currency and order id, checks that the transaction id embeds the order id, and checks WiPay's md5 `hash` on success. In live mode it refuses sandbox transactions. |
| `manual.provider.ts` | `ManualProvider` (`id: 'manual'`, label "Bank transfer", invoice mode). It is always configured. `payInvoice` returns no redirect, only `instructions` (`BILLING_MANUAL_INSTRUCTIONS`, followed by the amount and the invoice number to quote). `parseWebhook` always rejects. A platform admin marks these invoices paid. Also exports `formatMoney()`. |
| `*.test.ts` | `stripe`, `paypal`, `paddle`, `wipay` and `manual` provider tests (`isConfigured`, checkout or `payInvoice`, subscription changes, webhook verification, event mapping), plus `http.test.ts` (money conversion, `safeEqual`, `send` timeouts). |

## Environment variables per provider

A provider is offered to schools only when all three of these hold:

1. its id is listed in `PAYMENT_PROVIDERS`;
2. its `isConfigured()` returns true;
3. a platform admin has not switched it off (`billing.provider_setting`).

| Provider | Required | Optional |
|----------|----------|----------|
| `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `STRIPE_PRICE_PER_USER`, `STRIPE_PRICE_FLAT` |
| `paypal` | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | `PAYPAL_ENV` (`sandbox` by default, or `live`), `PAYPAL_PLAN_PER_USER`, `PAYPAL_PLAN_FLAT`, `PAYPAL_PRODUCT_ID` |
| `paddle` | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | `PADDLE_ENV` (`sandbox` by default, or `production`), `PADDLE_PRICE_PER_USER`, `PADDLE_PRICE_FLAT`, `PADDLE_PRODUCT_ID`, `PADDLE_CHECKOUT_URL` |
| `wipay` | `WIPAY_ACCOUNT_NUMBER`, `WIPAY_API_KEY` | `WIPAY_ENV` (`sandbox`/`live`), `WIPAY_COUNTRY_CODE` (`TT`/`JM`/`BB`), `WIPAY_CURRENCY` (`USD`/`TTD`/`JMD`; it must match the invoice currency), `WIPAY_FEE_STRUCTURE` (`merchant_absorb`/`customer_pay`/`split`) |
| `manual` | none | `BILLING_MANUAL_INSTRUCTIONS` |

The dashboard setup for each provider is described in [docs/content/billing-providers.md](../../../../docs/content/billing-providers.md).

## How the parent module uses providers

- `BillingRegistry` (`../billing.registry.ts`) builds the list with `defaultProviders()` and decides which providers are enabled.
- `BillingService` calls `createCheckout`, `payInvoice`, `changePlan`, `cancel`, `resume` and `portalUrl`.
- `SeatService` calls `updateQuantity` from the hourly sync.
- `BillingWebhookController` hands `POST` and `GET /api/billing/webhooks/<id>` requests to `parseWebhook`, with `rawBody` (the exact bytes, kept by `../raw-body.ts`), lower-cased `headers` and `query`. It then passes the returned events to `BillingEventsService`.
- `BillingEventsService` matches events to schools by `(provider, providerSubscriptionId)`, by the `schoolId` taken from the metadata you attached at checkout, or by our `invoiceId` for invoice-mode providers. It makes every event idempotent on `(provider, eventId)`.

## How to add a new payment provider

1. **Create `providers/<name>.provider.ts`** with a class that implements `PaymentProvider` from `./payment-provider`:
   - `readonly id`: a stable, lower-case id such as `'acme'`. It is stored on `billing.subscription.provider` and `billing.invoice.provider`, it appears in the webhook URL `/api/billing/webhooks/<id>`, and operators list it in `PAYMENT_PROVIDERS`. Never change it once you have shipped it.
   - `readonly label`: shown to school admins as "Pay with <label>".
   - `readonly mode`: `'subscription'` or `'invoice'`.
   - `isConfigured()`: return true only when every required environment variable is present. Read them with `env()` from `./http`. The registry treats a throw as "not configured".
   - Take `options: ProviderOptions = {}` in the constructor and use `options.fetch ?? fetch` for every HTTP call, made through `send()` from `./http`, so tests can stub the network. Throw `ProviderApiError` for API failures and never put secrets in error messages.
2. **Implement the methods your mode needs.** All of them are optional on the interface, and billing answers 400 ("cannot …") when one it needs is missing.
   - Subscription mode:
     - `createCheckout(ctx)`: put `ctx.schoolId` and `ctx.price.plan` into the provider's metadata so webhooks can be matched back to the school. Return `{ redirectUrl, providerRef, providerCustomerId }`. Use `ctx.idempotencyKey` if the provider supports one.
     - `updateQuantity`, `changePlan`, `cancel({ atPeriodEnd })`, `resume`, and optionally `portalUrl`.
   - Invoice mode:
     - `payInvoice(ctx)`: return `{ redirectUrl }` to a hosted page, or `{ redirectUrl: null, instructions }`.
     - If the provider calls back per payment, send `ctx.callbackUrl` (`API_URL/api/billing/webhooks/<id>`) and include `ctx.invoiceId` in what comes back.
   - Convert money with `centsToDecimal()` and `decimalToCents()`, never with floats.
3. **Implement `parseWebhook(req)`.**
   - Verify the signature or hash over `req.rawBody` (the exact bytes) using the provider's secret, and compare with `safeEqual()`.
   - On any failure, **throw `WebhookVerificationError`**. Never trust an unverified body.
   - Translate each provider event into a `BillingEvent`. Map the provider's statuses to `SubscriptionStatus`. Fill `eventId` with the provider's own event id, which is used for idempotency. Return `{ type: 'ignored', eventId, reason }` for event types you do not handle.
   - It helps to expose a `mapEvent()` method for tests, as the existing providers do.
   - If the provider sends the browser back (as WiPay does), the controller already routes `GET` requests and HTML or form `POST`s there and redirects to the billing page afterwards.
4. **Register it** in `defaultProviders()` in `../billing.registry.ts`: import the class and add `new <Name>Provider()` to the array. That is the only place in the app that lists providers.
5. **Update the registry test.** `../billing.registry.test.ts` asserts the exact list of ids returned by `defaultProviders()` (`['stripe', 'paypal', 'paddle', 'wipay', 'manual']`), so add your id there.
6. **Write `providers/<name>.provider.test.ts`**, modelled on `stripe.provider.test.ts` or `wipay.provider.test.ts`. Cover `isConfigured`, checkout or `payInvoice` against a stubbed `fetch`, webhook verification (valid, tampered, missing headers) and event mapping. Then run `cd backend && bun test src/billing`.
7. **Document the configuration**:
   - add the variables, commented out, to `backend/.env.example`;
   - add them to `docs/content/environment-variables.md`, and add the id to the `PAYMENT_PROVIDERS` row there;
   - add a section to `docs/content/billing-providers.md` and to the table above.
8. **Turn it on** for a deployment:
   - add the id to `PAYMENT_PROVIDERS` and set the credentials;
   - point the provider's webhook at `https://<API_URL>/api/billing/webhooks/<id>`;
   - check that `GET /api/platform/providers` shows the provider as `configured`, then switch it on in the platform dashboard (`PATCH /api/platform/providers/<id>`).

You do not need to change the database, the controllers or the DTOs. `CheckoutDto.provider` and `PayInvoiceDto.provider` accept any id of at most 40 characters, and `BillingRegistry.getEnabled()` rejects ids that are unknown or disabled.
