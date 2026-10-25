---
label: Billing providers
---

# Billing providers

A step-by-step version for operators, with troubleshooting, lives next to the code: [`backend/src/billing/STRIPE.md`](../../backend/src/billing/STRIPE.md).


The hosted platform takes payments through **one provider: Stripe**. Paying
happens entirely on Stripe's hosted pages: schools subscribe through
**Stripe Checkout** and manage their card and invoices in the **Stripe
Customer Portal**. No card form is ever shown on GradeBook's own pages, and
card details never reach our servers. How billing works overall (plans,
trial, read-only mode, invoices) is in **[Billing](./backend/billing.md)**;
every variable is listed in
**[Environment variables](./environment-variables.md)**.

Stripe is offered to schools when billing is on (`BILLING_ENABLED=true`) and
**both** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set. If billing is
on but Stripe is not configured, the API logs a warning at startup, the school
billing page tells admins that payments are not configured yet, and checkout
answers `503`. Payments are online only: there is no bank-transfer or manual
option, and there is no on/off switch to manage. The code is in
`backend/src/billing/providers/stripe.provider.ts`.

| Variable | Required | What it is |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Yes | Secret API key, `sk_test_...` in test mode or `sk_live_...` in live mode. |
| `STRIPE_WEBHOOK_SECRET` | Yes | The webhook endpoint's signing secret, `whsec_...`. |
| `STRIPE_PRICE_PER_USER` | No | An existing recurring monthly per-unit price for the per-user plan. |
| `STRIPE_PRICE_FLAT` | No | An existing recurring monthly price for the flat plan. |

Unless you pin Stripe price ids, prices come from the platform settings
(`BILLING_PER_USER_CENTS`, `BILLING_FLAT_CENTS`, `BILLING_CURRENCY`). If you
pin them, keep the amounts in step with the platform settings: the app shows
its own estimate, but Stripe charges what its price says.

---

## Dashboard setup

Do this in **test mode** first, then again in **live mode** (keys, webhook
endpoints and portal settings are separate per mode).

1. **Developers > API keys**: copy the secret key (`sk_test_...` /
   `sk_live_...`) into `STRIPE_SECRET_KEY`. A restricted key works if it can
   write Checkout Sessions, Customers, Products, Prices, Subscriptions and
   Billing Portal sessions.
2. **Developers > Webhooks > Add destination** (older dashboards: *Add
   endpoint*). Events from *Your account*, payload style **Snapshot** (not
   Thin), destination type *Webhook endpoint*. Not needed for local
   development, where `stripe listen` forwards events and
   `stripe listen --print-secret` prints the secret:
   - URL: `${API_URL}/api/billing/webhooks/stripe`, for example
     `https://api.example.com/api/billing/webhooks/stripe`.
   - Enable exactly these events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`

     Other events are accepted and ignored, so sending more does no harm.
   - Copy the endpoint's signing secret (`whsec_...`) into
     `STRIPE_WEBHOOK_SECRET`.
3. **Settings > Billing > Customer portal**: activate the portal, then:
   - allow customers to **update payment methods**;
   - turn on **invoice history** so admins can see and download invoices;
   - leave **cancel subscriptions** off (GradeBook has its own Cancel and
     Resume buttons, which keep our records in step);
   - leave **switch plans / update quantities** off, or add no products to
     the portal: plan changes and seat counts are made from GradeBook.
4. Optional: **Settings > Billing > Subscriptions and emails**: turn on smart
   retries and failed-payment emails.

## Prices

- **Default (no setup):** inline monthly prices (`price_data`) built from
  the platform amounts. They hang off two products that are created on first
  use with fixed ids: `gradebook_per_user` ("GradeBook per user") and
  `gradebook_flat` ("GradeBook flat").
- **Pinned prices (optional):** create recurring monthly prices and set
  `STRIPE_PRICE_PER_USER` (per-unit price; the quantity is the seat count)
  and/or `STRIPE_PRICE_FLAT`.

## Behaviour

- Checkout: a Checkout Session in subscription mode. `schoolId` and `plan` go
  in both the session metadata and `subscription_data.metadata`. An existing
  customer is reused, otherwise the admin's email is prefilled. The
  checkout's idempotency key is sent as Stripe's `Idempotency-Key`. The school
  comes back to `${APP_URL}/dashboard/settings/billing?checkout=success` (or
  `?checkout=cancel`); the subscription turns active when the webhook
  arrives.
- Seat changes and plan changes update the subscription item with
  `proration_behavior=create_prorations` (the difference lands on the next
  invoice).
- Cancel: at period end sets `cancel_at_period_end`; immediate cancel
  deletes the subscription. Resume clears `cancel_at_period_end`.
- Portal ("Manage payment method & invoices"): a Billing Portal session for
  the subscription's customer.
- Invoices: each `invoice.paid` is recorded as a paid GradeBook invoice
  (`GB-YYYYMM-<seq>`) for the school's history. Stripe owns the invoice
  itself; its PDF and receipt are in the Customer Portal.
- Status mapping: `incomplete_expired` becomes canceled; `paused` becomes
  past_due; the other statuses map one to one.
- Webhooks are verified with the `Stripe-Signature` header over the exact raw
  body (5-minute tolerance). A failed check answers 400; events are
  idempotent by Stripe's event id.

## Test mode and local development

- Use test keys (`sk_test_...`). Nothing is charged.
- Cards: `4242 4242 4242 4242` succeeds; `4000 0025 0000 3155` asks for 3-D
  Secure; `4000 0000 0000 0341` attaches but fails at charge time (use it to
  see `invoice.payment_failed`). Use any future expiry and any CVC.
- Local webhooks with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

  ```bash
  stripe login
  stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to localhost:3001/api/billing/webhooks/stripe
  ```

  It prints a temporary `whsec_...`. Put that in `STRIPE_WEBHOOK_SECRET` in
  `backend/.env` (with `BILLING_ENABLED=true` and your `sk_test_...` in
  `STRIPE_SECRET_KEY`), restart the API, then subscribe from
  **Settings > Billing** in the web app. `stripe trigger invoice.payment_failed`
  and friends send sample events (they carry no `schoolId`, so they are
  logged and ignored).
- Test clocks (*Billing > Test clocks*) let you fast-forward renewals.

---

## Adding another provider later

The app is built so another provider can be added without touching the rest
of billing:

1. Implement `PaymentProvider` from
   `backend/src/billing/providers/payment-provider.ts` in
   `backend/src/billing/providers/<id>.provider.ts`: `id`, `label`,
   `isConfigured()` from its env vars, `createCheckout`, `updateQuantity`,
   `changePlan`, `cancel`, `resume`, `portalUrl`, and `parseWebhook`, which
   **must** verify the raw body and throw `WebhookVerificationError` when it
   does not check out.
2. Register it in `defaultProviders()` in
   `backend/src/billing/providers/billing.registry.ts`.
3. Document its env vars here, in `backend/.env.example`,
   `infrastructure/env.example` and
   [Environment variables](./environment-variables.md), and point its
   webhooks at `${API_URL}/api/billing/webhooks/<id>`.

See [Billing](./backend/billing.md#adding-a-provider) for the details. Note
that offering more than one provider would bring back a provider choice in
the school billing page.
