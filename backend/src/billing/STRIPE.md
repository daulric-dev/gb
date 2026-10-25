# Connecting GradeBook to Stripe

Step-by-step setup for hosted billing with Stripe: from a new Stripe account to
a school paying for a plan. Billing only exists on the hosted platform; a
self-hosted install leaves `BILLING_ENABLED` unset and skips all of this.

How payment works, so the steps make sense:

1. A school admin picks a plan in **Settings → Billing** and clicks
   **Continue to payment**.
2. The API creates a **Stripe Checkout** session (subscription mode) and the
   browser goes to Stripe's page. The card is entered there and never reaches
   GradeBook.
3. Stripe sends **webhooks** to the API; the subscription becomes active only
   when a verified webhook says so.
4. **Manage payment method & invoices** opens the **Stripe Customer Portal**.
5. Every hour the API pushes the school's number of active users to Stripe
   (per-user plan), with proration.

Code: [`providers/stripe.provider.ts`](./providers/stripe.provider.ts) (the
adapter), [`billing-webhook.controller.ts`](./billing-webhook.controller.ts),
[`billing-events.service.ts`](./billing-events.service.ts). Module overview:
[`README.md`](./README.md).

---

## 1. Create the Stripe account

1. Sign up at https://dashboard.stripe.com and activate the account (business
   details, bank account for payouts). Until it is activated you can still use
   **test mode**.
2. Set the account's **default currency** and statement descriptor
   (Settings → Business → Public details), e.g. `GRADEBOOK`.
3. Do everything below first in **test mode** (toggle top right), then repeat
   it in **live mode** for production. Test and live have separate keys,
   prices, webhooks and portal settings.

## 2. API keys

Developers → **API keys**:

| Key | Use |
| --- | --- |
| Secret key `sk_test_…` / `sk_live_…` | `STRIPE_SECRET_KEY` on the API server |
| Publishable key `pk_…` | Not needed: GradeBook has no card form of its own |

Recommended for production: create a **restricted key** instead of using the
full secret key, with write access to *Checkout Sessions, Customers,
Subscriptions, Customer portal, Products, Prices* and read access to
*Invoices*. Treat it like a password: server-side only, never in the frontend
or the mobile app, never committed.

## 3. Prices (optional)

Two plans exist: **per user** (`BILLING_PER_USER_CENTS`, default 500 = $5 per
active user per month) and **flat** (`BILLING_FLAT_CENTS`, default 30000 =
$300 per month), in `BILLING_CURRENCY` (default `USD`).

You can let GradeBook manage prices or create your own:

- **Let GradeBook do it (simplest).** Leave `STRIPE_PRICE_*` unset. On first
  checkout the API creates two products, `gradebook_per_user` ("GradeBook per
  user") and `gradebook_flat` ("GradeBook flat"), and charges the configured
  amounts as monthly prices on them. To change a price, change the
  `BILLING_*_CENTS` variable; new checkouts use it.
- **Use your own Stripe prices.** Product catalogue → **Add product** twice,
  each with a **recurring, monthly** price in your currency:
  - per user: **per unit** pricing (the quantity is the number of users);
  - flat: a fixed amount (quantity 1).

  Copy the price ids (`price_…`) into `STRIPE_PRICE_PER_USER` and
  `STRIPE_PRICE_FLAT`. Keep `BILLING_*_CENTS` equal to them, because the
  Billing page shows those amounts.

The 30-day trial is GradeBook's own (`BILLING_TRIAL_DAYS`); do not add a trial
period to the Stripe prices.

## 4. Webhook endpoint

Developers → **Webhooks** → **Add endpoint**:

- **Endpoint URL**: `https://<your API host>/api/billing/webhooks/stripe`
  (the API's public address, the same host as `API_URL`).
- **Events to send** (exactly these six):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- After saving, reveal the **Signing secret** (`whsec_…`) and set it as
  `STRIPE_WEBHOOK_SECRET`.

The API verifies every webhook against that secret over the exact request body
and refuses anything older than 5 minutes, so the endpoint must be reached
directly. A proxy must not rewrite the body, and the server clock must be
correct. Each event is processed once: duplicates and retries are recognised
by their event id. A webhook that fails processing returns 500 so Stripe
retries it.

## 5. Customer Portal

Settings → Billing → **Customer portal** → activate it, then:

- **Allow**: update payment methods, view invoice history (and download PDFs),
  update billing details.
- **Cancellations**: turn **off** (or "at end of billing period" only). Admins
  cancel and resume in GradeBook, which keeps both sides in step.
- **Subscription updates / plan switching**: turn **off**. Plan changes go
  through GradeBook so seat counts and plan names stay correct.
- **Default redirect link**: `https://<your web app>/dashboard/settings/billing`.
- Add your terms and privacy links (`/terms`, `/privacy`).

## 6. Recommended account settings

- **Settings → Billing → Subscriptions and emails**: turn on Smart Retries
  and the failed-payment emails, and choose **"mark the subscription as
  unpaid"** (or cancel) when all retries fail. GradeBook gives a 7-day grace
  period after a failed payment (`BILLING_GRACE_DAYS`), then makes the school
  read-only until it pays.
- **Settings → Customer emails**: turn on receipts for successful payments.
- **Tax**: if you need to charge VAT or sales tax, set it up with Stripe Tax and
  your tax registrations. GradeBook's checkout doesn't add tax on its own.
- **Team**: give teammates the least access they need (Developers only for
  engineers).

## 7. Configure the API

In the API's environment (`backend/.env` locally, `infrastructure/.env` or your
platform's secrets in production):

```bash
BILLING_ENABLED=true                     # hosted platform only
STRIPE_SECRET_KEY=sk_live_...            # or the restricted key (rk_live_...)
STRIPE_WEBHOOK_SECRET=whsec_...
# Optional: your own prices (otherwise GradeBook creates them)
# STRIPE_PRICE_PER_USER=price_...
# STRIPE_PRICE_FLAT=price_...

# Prices shown and charged, trial and grace
BILLING_PER_USER_CENTS=500
BILLING_FLAT_CENTS=30000
BILLING_CURRENCY=USD
BILLING_TRIAL_DAYS=30
BILLING_GRACE_DAYS=7

# Where Stripe sends people back to (defaults to FRONTEND_URL)
APP_URL=https://app.example.com

# Who can open the developer dashboard (/platform)
PLATFORM_ADMIN_EMAILS=you@example.com
```

Restart the API. Then check:

- No warning about payments not being configured in the startup log. Without
  both Stripe keys the API logs one, `POST /api/billing/checkout` returns 503,
  and the Billing page tells admins payments aren't set up.
- As a school admin, **Settings → Billing** shows the plans and a **Continue
  to payment** button.
- In the developer dashboard (`/platform`) the overview has no
  "payments not configured" warning.

The full variable list is in
[`docs/content/environment-variables.md`](../../../docs/content/environment-variables.md).

## 8. Test it locally

1. Install the Stripe CLI (https://stripe.com/docs/stripe-cli) and log in:
   `stripe login`.
2. Forward webhooks to your local API:

   ```bash
   stripe listen --forward-to localhost:3001/api/billing/webhooks/stripe
   ```

   It prints a `whsec_…` secret for this session: put it in `backend/.env` as
   `STRIPE_WEBHOOK_SECRET` (with your `sk_test_…` key) and restart the API.
3. Sign in as `admin@demo.test` (`bun run seed:demo` creates it), open
   **Settings → Billing**, pick a plan and pay with a test card:

   | Card | Result |
   | --- | --- |
   | `4242 4242 4242 4242` | Succeeds |
   | `4000 0025 0000 3155` | Requires 3-D Secure authentication |
   | `4000 0000 0000 9995` | Declined (insufficient funds) |
   | `4000 0000 0000 0341` | Attaches, then fails on the next charge (tests `invoice.payment_failed`) |

   Any future expiry date, any CVC, any postcode.
4. Watch `stripe listen` print the events, and the Billing page change from
   **Trial** to **Active**.
5. Try **Manage payment method & invoices**, **Cancel** (status shows it ends
   at period end), and **Resume**.
6. Simulate time passing with **Test clocks** (Billing → Test clocks) to see
   renewals, failed payments and the read-only mode after the grace period.

## 8b. Testing with stripe-mock (no Stripe account)

[stripe-mock](https://github.com/stripe/stripe-mock) is Stripe's official mock of
its API. It accepts any `sk_test_` key, checks every request against Stripe's
API specification (wrong parameter names or types fail), and answers with
realistic fixture objects. It is **stateless** (it doesn't remember what you
created) and **sends no webhooks**, so tests play Stripe's part by signing
webhooks themselves. Use it for development and automated tests; use real test
mode (step 8) to see Stripe's actual checkout pages.

1. Start it (it is in the dev compose file, pinned to `v0.206.0`):

   ```bash
   docker compose -f docker-compose.dev.yml up -d stripe-mock   # 127.0.0.1:12111
   ```

2. Point the API at it in `backend/.env` and restart the API:

   ```bash
   BILLING_ENABLED=true
   STRIPE_API_BASE=http://127.0.0.1:12111   # development and tests only
   STRIPE_SECRET_KEY=sk_test_mock           # any sk_test_ value
   STRIPE_WEBHOOK_SECRET=whsec_dev_stripe_mock   # any value; tests sign with it
   ```

   `STRIPE_API_BASE` is refused when `NODE_ENV=production`, so a stray setting
   can't send real payments to the mock.
3. What runs against it:
   - **`bun run smoke`**: when `STRIPE_API_BASE` is set it drives the whole
     flow: checkout returns a `checkout.stripe.com` URL; signed
     `checkout.session.completed`, `customer.subscription.updated` and
     `invoice.paid` webhooks make the school active with its renewal date and a
     paid invoice; a replayed event is only applied once; a forged signature is
     refused; then cancel, resume, the portal URL, and
     `customer.subscription.deleted`. It restores the school's billing state
     afterwards.
   - **Adapter integration tests**, `src/billing/providers/stripe.mock.test.ts`:
     every Stripe call the adapter makes (checkout for both plans, seat and plan
     changes, cancel, resume, portal) is validated by the mock. They run when
     `STRIPE_MOCK_URL` is set and are skipped otherwise:

     ```bash
     STRIPE_MOCK_URL=http://127.0.0.1:12111 bun test src/billing
     ```

     CI (`.github/workflows/ci.yml` and `codecov.yml`) starts stripe-mock as a
     service and sets `STRIPE_MOCK_URL`, so they always run there.
4. Clicking **Continue to payment** in the browser goes to a fake Checkout URL
   that doesn't load; that is expected with the mock. To finish a payment, send
   the webhooks the way the smoke test does (`stripeMockFlow` in
   `backend/scripts/smoke.ts`), or switch to real test mode.

How the tests sign webhooks, if you need to do it by hand: the header is
`Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with
STRIPE_WEBHOOK_SECRET>`, and the body is a Stripe event JSON
(`{ "id": "evt_...", "type": "...", "data": { "object": { ... } } }`).

## 9. Go live

1. Activate the Stripe account.
2. Repeat steps 3-6 in **live mode**: live prices (if you use your own),
   live webhook endpoint (new `whsec_…`), live portal settings.
3. Set the live `STRIPE_SECRET_KEY` (or restricted key) and
   `STRIPE_WEBHOOK_SECRET` in production, and restart.
4. Make one real purchase with your own card on a test school, check the
   webhook deliveries show **200** in Developers → Webhooks, then refund it
   from the dashboard.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Payments are not configured yet" | `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` missing, or `BILLING_ENABLED` not `true` |
| Checkout works but the school stays on Trial | Webhooks not arriving: wrong URL, endpoint in the other mode (test vs live), or event types missing. Check Developers → Webhooks → the endpoint's delivery log. |
| Webhook deliveries show 400 | Wrong `STRIPE_WEBHOOK_SECRET` (each endpoint and each `stripe listen` session has its own), a proxy changing the body, or the server clock is off |
| Webhook deliveries show 500 | The API failed to apply the event; it will retry. Check the API log for the event id. |
| Per-user quantity not updating | Seat sync runs hourly; subscriptions set to cancel at period end are not updated |
| "Manage payment method" does nothing | Customer Portal not activated in that mode (test/live) |
| Wrong currency or price | `BILLING_*` values don't match your `STRIPE_PRICE_*` prices |
| Startup error "STRIPE_API_BASE is for development and tests only" | Remove `STRIPE_API_BASE` from the production environment |

Refunds, voided invoices and disputes are handled in the Stripe dashboard;
GradeBook only records paid invoices it receives by webhook.

## See also

- [`docs/content/billing-providers.md`](../../../docs/content/billing-providers.md): Stripe setup on the docs site
- [`docs/content/billing-staging.md`](../../../docs/content/billing-staging.md): staging checklist
- [`docs/content/backend/billing.md`](../../../docs/content/backend/billing.md): how billing works (lifecycle, data model, endpoints)
- [`providers/README.md`](./providers/README.md): the provider interface, and how to add another provider
