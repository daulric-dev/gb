---
label: Billing providers
---

# Billing providers

How to set up each payment provider the hosted platform can offer schools:
Stripe, PayPal and Paddle run the subscription themselves; WiPay collects
one monthly invoice at a time on its hosted card page. How billing works
overall (plans, trial, read-only mode, invoices, `PAYMENT_PROVIDERS`) is in
**[Billing](./backend/billing.md)**; every variable is listed in
**[Environment variables](./environment-variables.md)**.

A provider is offered only when it is listed in `PAYMENT_PROVIDERS`, its
credentials below are set (`isConfigured()`), and a platform admin has not
switched it off. Each provider's code lives in
`backend/src/billing/providers/<id>.provider.ts`.

Every provider posts to one webhook URL:

```
${API_URL}/api/billing/webhooks/<provider id>
```

for example `https://api.example.com/api/billing/webhooks/stripe`. The body is
verified before anything is trusted. A failed check answers 400, and events
are idempotent by the provider's event id.

| Provider | id | Mode | Required env |
| --- | --- | --- | --- |
| Stripe | `stripe` | subscription | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| PayPal | `paypal` | subscription | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (+ `PAYPAL_ENV`) |
| Paddle Billing | `paddle` | subscription | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` (+ `PADDLE_ENV`) |
| WiPay | `wipay` | invoice | `WIPAY_ACCOUNT_NUMBER`, `WIPAY_API_KEY` (+ `WIPAY_ENV`, `WIPAY_COUNTRY_CODE`) |

Prices always come from the platform settings (`BILLING_PER_USER_CENTS`,
`BILLING_FLAT_CENTS`, `BILLING_CURRENCY`) unless you pin provider price ids,
described per provider below. If you pin them, keep the amounts in step with
the platform settings: the app shows its own estimate, but the provider
charges what its price says.

---

## Stripe

Uses the official [`stripe`](https://github.com/stripe/stripe-node) SDK with
Checkout Sessions in subscription mode.

### Dashboard setup (do it in test mode first, then again in live mode)

1. **Developers > API keys**: copy the secret key (`sk_test_...` /
   `sk_live_...`) into `STRIPE_SECRET_KEY`. A restricted key works if it can
   write Checkout Sessions, Customers, Products, Prices, Subscriptions and
   Billing Portal sessions.
2. **Developers > Webhooks > Add endpoint** (in newer dashboards it's
   *Workbench > Webhooks > Create an event destination*, type
   *Your account*):
   - URL: `${API_URL}/api/billing/webhooks/stripe`
   - Events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
   - Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
3. **Settings > Billing > Customer portal**: activate the portal, and allow
   updating payment methods and viewing invoices. Turn **off** "customers can
   change quantity / switch plans / cancel" if seat counts and plan changes
   should only happen from GradeBook.
4. Optional: **Settings > Billing > Subscriptions and emails**: turn on smart
   retries and failed-payment emails.

### Prices

- **Default (no setup):** inline monthly prices (`price_data`) built from
  the platform amounts. They hang off two products that are created on first
  use with fixed ids: `gradebook_per_user` ("GradeBook per user") and
  `gradebook_flat` ("GradeBook flat").
- **Pinned prices (optional):** create recurring monthly prices and set
  `STRIPE_PRICE_PER_USER` (per-unit price; the quantity is the seat count)
  and/or `STRIPE_PRICE_FLAT`.

### Behaviour

- Checkout: `schoolId` and `plan` go in both the session metadata and
  `subscription_data.metadata`. An existing customer is reused, otherwise
  the admin's email is prefilled. The checkout's idempotency key is sent as
  Stripe's `Idempotency-Key`.
- Seat changes and plan changes update the subscription item with
  `proration_behavior=create_prorations` (the difference lands on the next
  invoice).
- Cancel: at period end sets `cancel_at_period_end`; immediate cancel
  deletes the subscription. Resume clears `cancel_at_period_end`.
- Portal: a Billing Portal session for the subscription's customer.
- Status mapping: `incomplete_expired` becomes canceled; `paused` becomes
  past_due; the other statuses map one to one.

### Testing

- Cards: `4242 4242 4242 4242` succeeds; `4000 0025 0000 3155` asks for 3-D
  Secure; `4000 0000 0000 0341` attaches but fails at charge time (use it to
  see `invoice.payment_failed`). Use any future expiry and any CVC.
- Local webhooks: `stripe listen --forward-to localhost:3001/api/billing/webhooks/stripe`
  prints a temporary `whsec_...`. Put that in `STRIPE_WEBHOOK_SECRET` while
  testing.
- Test clocks (*Billing > Test clocks*) let you fast-forward renewals.

---

## PayPal

Uses the REST API directly: OAuth client credentials, with the token cached
until shortly before it expires. PayPal's Node SDKs for subscriptions are
deprecated.

### Dashboard setup ([developer.paypal.com](https://developer.paypal.com))

1. **Apps & Credentials**: create an app under **Sandbox** (and later one
   under **Live**). Copy the Client ID and Secret into `PAYPAL_CLIENT_ID` and
   `PAYPAL_CLIENT_SECRET`.
2. Set `PAYPAL_ENV=sandbox` (uses `api-m.sandbox.paypal.com`) or
   `PAYPAL_ENV=live` (uses `api-m.paypal.com`). Sandbox and live credentials
   are not interchangeable.
3. In the app, **Add webhook**:
   - URL: `${API_URL}/api/billing/webhooks/paypal`
   - Events:
     - `BILLING.SUBSCRIPTION.ACTIVATED`
     - `BILLING.SUBSCRIPTION.UPDATED`
     - `BILLING.SUBSCRIPTION.RE-ACTIVATED`
     - `BILLING.SUBSCRIPTION.SUSPENDED`
     - `BILLING.SUBSCRIPTION.CANCELLED`
     - `BILLING.SUBSCRIPTION.EXPIRED`
     - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
     - `PAYMENT.SALE.COMPLETED`
   - Copy the webhook **ID** (not a secret) into `PAYPAL_WEBHOOK_ID`.
4. The business account must have subscriptions (recurring payments)
   enabled. Sandbox business accounts do.

### Plans

- **Default (no setup):** on first checkout the API finds or creates a
  catalog product named "GradeBook". It then finds or creates one active
  monthly plan per price, named for example `GradeBook per user USD 5.00` or
  `GradeBook flat USD 300.00`. The per-user plan has `quantity_supported`.
  Ids are cached in memory, and existing plans are found by name after a
  restart.
- **Pinned (recommended for live):** create the plans yourself and set
  `PAYPAL_PLAN_PER_USER` (per-unit price, *quantity supported* on) and
  `PAYPAL_PLAN_FLAT`. Optionally set `PAYPAL_PRODUCT_ID` to reuse your own
  catalog product.

### Behaviour and limitations

- Checkout creates a subscription with `custom_id = schoolId`, the seat
  count as `quantity` (per-user only), and return/cancel URLs. The browser
  goes to the `approve` link. The checkout idempotency key is sent as
  `PayPal-Request-Id`.
- **Seat and plan changes need the payer's approval.** Quantity and plan
  changes go through `POST /v1/billing/subscriptions/{id}/revise`, which
  PayPal documents as requiring buyer consent. When PayPal answers with an
  approval link, the API logs a warning and PayPal keeps billing the old
  quantity until the payer approves. Automatic seat syncing is therefore
  best effort on PayPal. Schools with changing headcounts are better served
  by the flat plan or another provider.
- **Cancel at period end is approximated.** PayPal has no
  "cancel at period end": a cancel is immediate and cannot be undone. So
  `cancel({ atPeriodEnd: true })` **suspends** the subscription with a
  GradeBook reason. No further charges are taken, and the suspension is
  reported as *active, cancelling at period end*, so the school keeps the
  time it paid for. `resume` re-activates it. A suspension PayPal makes after
  failed payments is reported as past_due. An immediate cancel calls
  PayPal's cancel. A suspended subscription stays suspended in PayPal until
  it is cancelled; cancel it in PayPal (or immediately from the platform)
  once the period is over if you want it closed there too.
- There is no customer portal (`portalUrl` returns null). Payers manage
  their payment method in their PayPal account.
- Webhooks are verified by calling `POST /v1/notifications/verify-webhook-signature`
  with the `paypal-transmission-id`, `-time`, `-sig`, `paypal-cert-url` and
  `paypal-auth-algo` headers and the event. Only `SUCCESS` is accepted.
- Payments arrive as `PAYMENT.SALE.COMPLETED`, matched to the subscription
  by `billing_agreement_id`. Plan names only come back on events for plans
  this deployment knows (pinned ids or plans it created).

### Testing

- **Sandbox > Accounts** has a default personal (buyer) account; its email
  and password are under *View/edit account*. Log in with it on the approve
  page.
- Sandbox renewals run on PayPal's schedule (daily plans are useful for
  manual tests). The **Webhooks simulator** can send sample events, but
  simulated events don't pass signature verification against a real webhook
  id. Use real sandbox subscriptions for end-to-end tests.

---

## Paddle Billing

Uses the Paddle Billing REST API (not Paddle Classic) with plain fetch,
`Paddle-Version: 1`.

### Dashboard setup

Use [sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com) first,
then [vendors.paddle.com](https://vendors.paddle.com).

1. **Developer tools > Authentication**: create an API key with write access
   to transactions, subscriptions, customers (and customer portal
   sessions). Put it in `PADDLE_API_KEY`.
2. Set `PADDLE_ENV=sandbox` (uses `sandbox-api.paddle.com`) or
   `PADDLE_ENV=production` (uses `api.paddle.com`).
3. **Checkout > Checkout settings > Default payment link**: **required**.
   Checkout creates a transaction and sends the browser to its
   `checkout.url`, which is the default payment link plus `?_ptxn=<id>`.
   That page must load [Paddle.js](https://developer.paddle.com/paddle-js/about/include-paddlejs)
   (`Paddle.Initialize({ token })`), which opens the checkout for the
   transaction. Its success redirect is configured in Paddle.js
   (`checkout.settings.successUrl`), not by the API. Point it at
   `${APP_URL}/dashboard/settings/billing?checkout=success`. In live, the
   link's domain must be approved by Paddle. `PADDLE_CHECKOUT_URL` can
   override the page per transaction (it must also be on an approved
   domain). Without a default payment link, checkout fails with a clear
   error.
4. **Developer tools > Notifications > New destination**:
   - URL: `${API_URL}/api/billing/webhooks/paddle`
   - Events:
     - `subscription.created`
     - `subscription.activated`
     - `subscription.updated`
     - `subscription.past_due`
     - `subscription.paused`
     - `subscription.resumed`
     - `subscription.trialing`
     - `subscription.canceled`
     - `transaction.completed`
     - `transaction.payment_failed`
   - Copy the destination's secret key into `PADDLE_WEBHOOK_SECRET`.
5. Customer portal: enabled by default; brand it under **Checkout > Customer
   portal**.

### Prices

- **Default (no setup):** each checkout puts a non-catalog monthly price on
  the transaction, built from the platform amount (per user: seats 1 to
  100,000; flat: quantity 1). By default it sits on an inline non-catalog
  product with tax category `standard`. Set `PADDLE_PRODUCT_ID` to attach the
  prices to a catalog product of yours instead (for example one with the
  `saas` tax category, if that category is approved on your account).
- **Pinned (optional):** catalog prices in `PADDLE_PRICE_PER_USER` /
  `PADDLE_PRICE_FLAT`. They must be monthly, and the per-user price's
  quantity range must allow your largest school. **Paddle defaults to 1-100.**

### Behaviour and limitations

- Checkout sends `custom_data: { schoolId, plan, checkoutKey }` and an
  existing customer id, if the school has one. Paddle has no idempotency
  keys, so `checkoutKey` makes duplicates traceable. The admin's email is not
  sent: Paddle Checkout collects it (or prefill it in Paddle.js).
- Seat and plan changes `PATCH` the subscription items with
  `proration_billing_mode: prorated_immediately`, so the prorated difference
  is charged right away.
- Cancel uses `effective_from: next_billing_period` or `immediately`.
  Resume removes the scheduled change (`scheduled_change: null`).
- Portal: an authenticated customer portal session deep-linked to the
  subscription. The portal has no "return to app" URL.
- Webhooks: `Paddle-Signature: ts=...;h1=...` is HMAC-SHA256 of
  `"<ts>:<raw body>"` with the secret, compared in constant time. Several
  `h1` values (during secret rotation) are accepted. Timestamps more than 5
  minutes old or in the future are refused.
- Payments are reported once, on `transaction.completed`.
  `transaction.paid` (fired first for the same transaction) is ignored so a
  payment is never counted twice.
- Status mapping: `paused` becomes past_due; the others map one to one.

### Testing

- Sandbox card: `4242 4242 4242 4242`, any future expiry, any CVC (3-D
  Secure: `4000 0038 0000 0446`). Declines: use
  `4000 0000 0000 0002`.
- **Developer tools > Notifications** shows every delivery and can replay
  it. *Simulations* send sample events to a destination, and they are
  signed with that destination's secret.

---

## WiPay (Caribbean)

WiPay is an invoice-mode provider. The platform raises one invoice a month
and the admin pays it on WiPay's hosted card page. Implemented against
WiPay's *Payments API Documentation* v1.0.8 (23/12/2024), the "WiPay
Plugins Payment Request" API.

### Account setup

1. A **verified WiPay Business account** in Trinidad and Tobago, Jamaica or
   Barbados.
2. **Profile > Developer**: register the website you send requests from and
   copy the **API Key** into `WIPAY_API_KEY`. Put the 10-digit account number
   in `WIPAY_ACCOUNT_NUMBER`.
3. Set:
   - `WIPAY_ENV`: `sandbox` or `live` (default `sandbox`).
   - `WIPAY_COUNTRY_CODE`: `TT`, `JM` or `BB` (default `TT`). This picks
     the host `https://<cc>.wipayfinancial.com`. WiPay's API accepts only
     these three country codes; there is no Grenada platform.
   - `WIPAY_CURRENCY`: `USD`, `TTD` or `JMD` (default `USD`). It must equal
     `BILLING_CURRENCY`, because invoices in any other currency are refused
     rather than converted. Supported currencies depend on the country.
   - `WIPAY_FEE_STRUCTURE`: `merchant_absorb` (default), `customer_pay` or
     `split`. With `merchant_absorb`, schools pay exactly the invoice amount
     and the platform absorbs WiPay's fee (about 3-4.2% + tax or $0.25 per
     transaction, depending on the country). With `customer_pay`, the card
     is charged more than the invoice.
4. **No webhook to register.** Each payment request carries its own
   `response_url`: the core's `${API_URL}/api/billing/webhooks/wipay` with
   our parameters. WiPay redirects the browser there (GET) after the
   payment, and the core then sends the browser on to the billing page.

### Sandbox

Use `WIPAY_ENV=sandbox`, `WIPAY_ACCOUNT_NUMBER=1234567890`,
`WIPAY_API_KEY=123` (WiPay's public test account). Test cards (FAC hosted
page; any expiry, any CVV):

- `4111 1111 1111 1111` / `5111 1111 1111 1111`: approved.
- `4111 1111 1111 3333` / `5111 1111 1111 3333`: declined.

On the JM (FGB) page, use `4035 8740 0042 4977` or `5210 0000 1000 1001` for
approvals. If a 3-D Secure password is asked, it's the card's "Personal
Message" text.

Sandbox transaction ids start with `SB-`. In `live` mode such callbacks are
refused.

### How a payment is verified

WiPay's only proof is `hash = md5(transaction_id + original total + API key)`,
which is sent **only for successful payments**. Its `total` parameter is the
*final* amount (fees included under `customer_pay`), and `order_id` may be
at most 16 characters on the JM page, too short for an invoice id. So:

- `order_id` is a fresh 14-character reference per payment attempt (WiPay
  wants it unique).
- `response_url` carries `gb_inv` (invoice id), `gb_amt` (the total we
  sent), `gb_cur` and `gb_sig`. `gb_sig` is an HMAC keyed with the API key
  that binds those to the `order_id`.
- A callback counts only if `gb_sig` matches, the `transaction_id` contains
  `-<order_id>-` (WiPay builds ids that way), and for success, WiPay's md5
  hash matches `transaction_id + gb_amt + API key`. All comparisons are
  constant-time. A changed amount, invoice or order is refused with 400.
- `status=success` becomes `invoice.paid` for that invoice (eventId = WiPay
  transaction id). `failed`/`error` becomes `invoice.payment_failed`.
  Failures carry no WiPay hash by WiPay's design, so they are only as
  authentic as `gb_sig` (they prove a payment attempt we started) and should
  be treated as informational.

### Known limitations and assumptions

- **Confirm in sandbox before going live:** the code assumes WiPay appends
  its parameters to a `response_url` that already has a query string using
  `&`. A naive second `?` is also handled. If WiPay ever drops the existing
  query, callbacks fail verification (400) and the payment must be marked
  paid by a platform admin.
- `response_url` is limited to 255 characters by WiPay. With a normal
  `API_URL` it uses about 150.
- Minimum payment is 1.00 USD (or equivalent).
- Card currency: WiPay may debit a locally issued card in TTD/JMD while the
  request was in USD, using its own fixed rate. The invoice is still marked
  with the amount we requested.
- There is no recurring billing, portal or refunds through the API. Refunds
  are done in the WiPay dashboard.
