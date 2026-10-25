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
adapter), [`billing-webhook.controller.ts`](./webhooks/billing-webhook.controller.ts),
[`billing-events.service.ts`](./webhooks/billing-events.service.ts). Module overview:
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

For staging (sandbox) and production (a public URL). For production, follow
the full checklist in step 9. For local development skip this step and use
the Stripe CLI instead (step 8): its `whsec_…` comes from
`stripe listen --print-secret`.

In the dashboard open **Developers → Webhooks** (Workbench) → **Add
destination**:

- **Events from**: Your account.
- **Payload style**: **Snapshot** (not "Thin" - GradeBook reads the full
  objects inside each event). **API version**: leave the default.
- **Destination type**: Webhook endpoint.
- **Endpoint URL**: `https://<your API host>/api/billing/webhooks/stripe`
  (the API's public address, the same host as `API_URL`; `localhost` won't
  work here).
- **Events** (exactly these six):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- Create it, open the destination, and under **Signing secret** click
  **Reveal**. Set that `whsec_…` as `STRIPE_WEBHOOK_SECRET`.

Older dashboards call this **Add endpoint**; the fields are the same.

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

1. Put your sandbox key in `backend/.env` (`BILLING_ENABLED=true`,
   `STRIPE_SECRET_KEY=sk_test_…`).
2. Start the dev services:

   ```bash
   bun run preload        # Docker services + migrations + the Stripe listener
   ```

   `preload` runs `bun run stripe:listen` (`scripts/dev-stripe.ts`), which
   starts the `stripe-listen` container (the official Stripe CLI image,
   pinned in `docker-compose.dev.yml`), forwarding the six events to
   `http://localhost:3001/api/billing/webhooks/stripe`, and writes its signing
   secret into `backend/.env` as `STRIPE_WEBHOOK_SECRET`. If it updated the
   secret it says so: restart the API. It skips itself when billing is off or
   there is no key, and refuses live (`sk_live_`) keys.

   - Watch deliveries: `docker compose -f docker-compose.dev.yml logs -f stripe-listen`
     (each event shows `<-- [200]` once the API is running).
   - Stop just the listener: `bun run stripe:stop`; `bun run postload` stops
     everything.
   - No Docker? Use the CLI directly instead: `stripe login`, then
     `stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to localhost:3001/api/billing/webhooks/stripe`
     and copy the printed `whsec_…` into `backend/.env`.
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

## 9. Production webhook

Stripe tells GradeBook about payments only through the webhook, so production
billing doesn't work until this is in place. A school can pay on Stripe's
page and still stay on **Trial** if the webhook never arrives.

### Before you start

- **Public HTTPS API.** Stripe must reach
  `https://<your API host>/api/billing/webhooks/stripe` from the internet, over
  HTTPS with a valid certificate (Stripe rejects self-signed certificates and
  plain HTTP in live mode). Use the API's host, the one in `API_URL`, not the
  web app's.
- **The API is configured for billing.** `BILLING_ENABLED=true` and
  `STRIPE_SECRET_KEY` set (the live key, step 2). Without them the route answers
  404 and every delivery fails.
- **Nothing rewrites the request.** The signature covers the exact bytes
  Stripe sends. A proxy, load balancer or WAF in front of the API must pass the
  body through unchanged: no re-encoding, no JSON reformatting, no body
  inspection that alters it, and no authentication on this path. A plain
  `proxy_pass` (as in `infrastructure/nginx/`) passes bodies through as-is.
- **Correct server clock.** Deliveries older than 5 minutes are refused, so
  keep NTP running on the API servers.
- **Firewall (optional).** If you only accept inbound traffic from known
  addresses, allow Stripe's webhook IPs:
  https://stripe.com/files/ips/ips_webhooks.json.

### Create the destination (live mode)

1. In the Stripe dashboard, switch to **live mode** (toggle top right). Test
   and live destinations are separate, and live payments only send events to
   live destinations.
2. **Developers → Webhooks → Add destination**.
3. **Events from**: Your account. **Payload style**: **Snapshot**.
   **API version**: leave the account default.
4. **Events**: select exactly these six:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. **Destination type**: Webhook endpoint.
6. **Destination name**: e.g. `gradebook-production`. **Endpoint URL**:
   `https://<your API host>/api/billing/webhooks/stripe`. Add a description
   such as "GradeBook production billing".
7. **Create destination**.

### Give the API the signing secret

1. Open the new destination. Under **Signing secret**, click **Reveal** and
   copy the `whsec_…`.
2. Store it in production as `STRIPE_WEBHOOK_SECRET`: in your platform's
   secret store, or in `infrastructure/.env` on a single box. Never commit it
   or put it in the frontend.
3. Restart (or redeploy) every API instance so they all pick it up.

Each destination has its own secret. Staging (sandbox) and production (live)
need separate destinations and separate secrets; don't copy one into the
other, and the `stripe listen` secret from local development works nowhere
else.

### Check it works

1. **Test event (if your dashboard offers it).** On the destination page,
   **Send test event** (for example `customer.subscription.updated`) should
   show **200**. A test event doesn't belong to any school, so GradeBook logs
   it and changes nothing. Don't use `stripe trigger` in live mode: it creates
   real objects.
2. **One real purchase.** Subscribe a test school with your own card, then on
   the destination's **Event deliveries** check that the six events show
   **200**, and that the school shows **Active** in Settings → Billing and in
   the developer dashboard (`/platform`). Refund the payment from the Stripe
   dashboard afterwards.

What a failed delivery means:

| Status in Stripe | Meaning |
| --- | --- |
| 404 | Wrong URL or path, or the API has billing off / Stripe keys missing |
| 400 | Signature check failed: wrong `STRIPE_WEBHOOK_SECRET` for this destination, the body was changed on the way, or the server clock is off |
| 500 | The API received a valid event but failed to apply it (for example the database was down). Check the API log for the event id. Stripe retries automatically. |
| Timeout / TLS error | The API isn't reachable at that URL from the internet, or its certificate is invalid |

### Keep it healthy

- **Retries.** Stripe retries failed live deliveries with backoff for up to 3
  days. Each event is applied once even if delivered several times, so retries
  and **Resend** are always safe.
- **Recovering missed events.** After an outage, open the destination, filter
  **Event deliveries** by failed, and **Resend** them.
- **Alerts.** Stripe emails the account owner when an endpoint keeps failing,
  and can disable an endpoint that has failed for several days. Make sure that
  email reaches someone, and check the destination is still **Enabled** after
  an incident.
- **Rotating the secret.** On the destination choose **Roll secret** and pick
  an expiry for the old one (for example 24 hours). During that window Stripe
  signs with both, so set the new `whsec_…` and restart all API instances
  before the old one expires.
- **Changing the URL** (new API domain): edit the destination's endpoint URL;
  the signing secret stays the same.
- **Adding events** later: only add events GradeBook handles. Anything else is
  answered with 200 and ignored, which is harmless but noisy.

## 10. Go live

1. Activate the Stripe account.
2. Repeat steps 3-6 in **live mode**: live prices (if you use your own) and
   live Customer Portal settings.
3. Set the live `STRIPE_SECRET_KEY` (or restricted key) in production.
4. Create the production webhook and set `STRIPE_WEBHOOK_SECRET` (step 9),
   then restart the API.
5. Make one real purchase with your own card on a test school, check the
   deliveries show **200**, then refund it from the dashboard.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Payments are not configured yet" | `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` missing, or `BILLING_ENABLED` not `true` |
| Checkout works but the school stays on Trial | Webhooks not arriving: wrong URL, endpoint in the other mode (test vs live), or event types missing. Check Developers → Webhooks → your destination's event deliveries (locally: the `stripe listen` output). |
| Webhook deliveries show 400 | Wrong `STRIPE_WEBHOOK_SECRET` (each endpoint and each `stripe listen` session has its own), a proxy changing the body, or the server clock is off |
| Webhook deliveries show 500 | The API failed to apply the event; it will retry. Check the API log for the event id. |
| Per-user quantity not updating | Seat sync runs hourly; subscriptions set to cancel at period end are not updated |
| "Manage payment method" does nothing | Customer Portal not activated in that mode (test/live) |
| Wrong currency or price | `BILLING_*` values don't match your `STRIPE_PRICE_*` prices |

Refunds, voided invoices and disputes are handled in the Stripe dashboard;
GradeBook only records paid invoices it receives by webhook.

## See also

- [`docs/content/billing-providers.md`](../../../docs/content/billing-providers.md): Stripe setup on the docs site
- [`docs/content/billing-staging.md`](../../../docs/content/billing-staging.md): staging checklist
- [`docs/content/backend/billing.md`](../../../docs/content/backend/billing.md): how billing works (lifecycle, data model, endpoints)
- [`providers/README.md`](./providers/README.md): the provider interface, and how to add another provider
