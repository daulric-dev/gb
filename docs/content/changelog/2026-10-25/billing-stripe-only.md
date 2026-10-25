---
sidebar_label: 2026-10-25 · Billing: Stripe only
sidebar_position: 4
---

# 2026-10-25 - Billing: Stripe is the only payment provider

The hosted platform now takes payments through **one provider, Stripe**, so
we are not running several providers side by side. Paying stays entirely on
Stripe's hosted pages: **Stripe Checkout** to subscribe and the **Stripe
Customer Portal** to change the card and download invoices. There is no card
form on GradeBook's pages. Self-hosted deployments are unaffected (billing
stays off unless `BILLING_ENABLED=true`).

## What changed

- **PayPal, Paddle and WiPay removed.** Their adapters
  (`backend/src/billing/providers/{paypal,paddle,wipay}.provider.ts`) and
  tests are deleted, along with the helpers only they used. The
  `PaymentProvider` interface and `billing.registry.ts` stay, so another
  provider can be added later (see
  [Billing providers](../../billing-providers.md#adding-another-provider-later)).
  The interface is simplified to what a subscription provider needs: no
  `mode`, no `payInvoice` / `InvoicePaymentContext`, and events no longer
  carry our own invoice id.
- **No provider allowlist or switches.** `PAYMENT_PROVIDERS` is gone, and so
  are the platform **Providers** page, `GET /api/platform/providers` and
  `PATCH /api/platform/providers/:id`. Stripe is offered whenever billing is on
  and `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are set. The
  `billing.provider_setting` table is left in place but no longer read.
- **Not configured yet.** With billing on and no Stripe keys, the API logs a
  warning at startup, `POST /api/billing/checkout` answers **503** ("Payments
  are not configured yet"), the school billing page shows a "payments are not
  configured yet - contact support" notice instead of empty buttons, and the
  platform overview flags it (`paymentsConfigured: false`).
- **Checkout.** `provider` in `POST /api/billing/checkout` is now optional
  (it defaults to Stripe); an unknown provider is still a 400. The billing page
  has one flow: pick a plan, **Continue to payment**, then **Manage payment
  method & invoices** (Customer Portal), cancel / resume.
- **Invoice mode removed.** Only WiPay used it: the daily invoice sweep,
  `POST /api/platform/invoices/generate` (and its **Generate invoices**
  button), `POST /api/billing/invoices/:id/pay` (and the **Pay** buttons), the
  rule that an overdue open invoice makes a school read-only, and the WiPay
  browser return (`GET /api/billing/webhooks/:providerId` and form POSTs) are
  gone. Webhooks are `POST /api/billing/webhooks/stripe` with a raw JSON body
  and a verified signature.
- **Invoices.** Each Stripe `invoice.paid` is still recorded as a paid
  invoice (`GB-YYYYMM-<seq>`) and listed for school admins and platform
  admins. The PDF and receipt stay in Stripe (Customer Portal) - we do not
  store Stripe's hosted invoice links, which avoids a migration. **Void** is
  removed (`POST /api/platform/invoices/:id/void`): Stripe owns the invoices
  and we only record paid ones. `openInvoices` is dropped from the platform
  overview and school rows.
- The Privacy Policy and Terms of Service now name Stripe as the payment
  provider.
- CodeQL: the SARIF filter exception for `wipay.provider.ts` is gone, so the
  workflow is back to the plain analyze-and-upload form.

## Deploy

- Remove `PAYMENT_PROVIDERS` and every `PAYPAL_*`, `PADDLE_*` and `WIPAY_*`
  variable from the API's environment (leftovers are ignored).
- Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, register the webhook
  endpoint `${API_URL}/api/billing/webhooks/stripe` with the events listed in
  [Billing providers](../../billing-providers.md#dashboard-setup), and configure
  the Customer Portal.
- No migration.
- **Existing rows on a removed provider** (for example `manual` or `wipay`):
  the provider id is treated as "no provider" - nothing crashes, nothing is
  called on it, and the school keeps access until its trial or paid period
  ends, then subscribes with Stripe. An old open invoice stays listed as
  history and no longer affects whether the school is read-only.

## Local development

Put Stripe **test** keys in `backend/.env` and forward webhooks with the
Stripe CLI:

```bash
stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to localhost:3001/api/billing/webhooks/stripe
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`, restart the API and
pay with `4242 4242 4242 4242`.

## Tests

`bun test src/billing` drops the PayPal, Paddle and WiPay suites and the
invoice-mode, sweep, pay and void tests; the test fake provider no longer has
a mode. `bun run smoke` checks that checkout answers 503 while Stripe is not
configured, that the removed routes are gone, and the school and platform
routes, read-only mode and its recovery as before.
