---
label: Billing staging checklist
---

# Billing staging checklist

Everything to do before turning billing on in production, run first on a
staging deployment with every provider in sandbox mode. How billing works is
in [Billing](./backend/billing.md); per-provider dashboard setup in
[Billing providers](./billing-providers.md).

> Self-hosted deployments never need this page: they leave `BILLING_ENABLED`
> unset and billing stays off.

## 1. Deploy

- [ ] Apply migrations: `cd backend && bun run db:deploy` (adds the `billing`
      schema, migration `20261024100000_billing`). Nothing to backfill: every
      school gets its trial row on its first request or within the hour, with
      a full `BILLING_TRIAL_DAYS` trial from that moment.
- [ ] Set on the API:
      ```env
      BILLING_ENABLED=true
      PAYMENT_PROVIDERS=stripe,paypal,paddle,wipay,manual   # whichever you test
      PLATFORM_ADMIN_EMAILS=you@example.com
      API_URL=https://api.staging.example.com
      APP_URL=https://staging.example.com
      BILLING_MANUAL_INSTRUCTIONS="Pay by bank transfer to ... (staging)"
      ```
      plus each provider's sandbox credentials
      ([Environment variables](./environment-variables.md#billing)).
- [ ] Restart, then `GET /api/billing/status` as any user answers
      `enabled: true`, and `GET /api/platform/providers` (as a platform admin)
      shows each provider `allowedByEnv: true, configured: true, enabled: true`.
      `configured: false` = a credential is missing.

## 2. Sandbox accounts and webhook URLs

| Provider | Sandbox | Webhook / callback URL |
| --- | --- | --- |
| Stripe | test mode keys (`sk_test_...`) | `https://api.staging.example.com/api/billing/webhooks/stripe` - events per [Billing providers](./billing-providers.md#stripe); copy the endpoint's `whsec_...` into `STRIPE_WEBHOOK_SECRET` |
| PayPal | developer.paypal.com sandbox app, `PAYPAL_ENV=sandbox` | `.../api/billing/webhooks/paypal`; its webhook id into `PAYPAL_WEBHOOK_ID` |
| Paddle | sandbox-vendors.paddle.com, `PADDLE_ENV=sandbox` | `.../api/billing/webhooks/paddle` (notification destination; its secret into `PADDLE_WEBHOOK_SECRET`); set a default payment link or `PADDLE_CHECKOUT_URL` |
| WiPay | `WIPAY_ENV=sandbox`, account `1234567890`, key `123` | none to register: the payer's browser returns to `.../api/billing/webhooks/wipay` (sent per payment) |
| Manual | always available | none - a platform admin marks invoices paid |

The webhook route must reach the API unmodified: no proxy that re-encodes
JSON bodies (signatures are checked over the exact bytes).

## 3. Test cards

| Provider | Approve | Decline / fail |
| --- | --- | --- |
| Stripe | `4242 4242 4242 4242` (3-D Secure: `4000 0025 0000 3155`) | `4000 0000 0000 0341` attaches, fails at charge |
| Paddle | `4242 4242 4242 4242` (3-D Secure: `4000 0038 0000 0446`) | `4000 0000 0000 0002` |
| PayPal | the sandbox personal (buyer) account | - |
| WiPay | `4111 1111 1111 1111`, `5111 1111 1111 1111` (JM page: `4035 8740 0042 4977`) | `4111 1111 1111 3333` |

Any future expiry, any CVC.

## 4. End to end, per provider

Use a staging school with a school admin and a teacher.

- [ ] **Trial**: the admin sees *Settings → Billing* trialing with days left;
      the teacher sees the trial banner but no billing link.
- [ ] **Checkout** (per-user plan): redirected to the provider, pay with the
      approve card, returned to `/dashboard/settings/billing?checkout=success`.
- [ ] **Webhook arrives**: within seconds the summary shows `active`, the
      provider, a `currentPeriodEnd` a month out. The platform school detail
      lists the events; `billing.payment_event` rows have `processed_at` set and
      no `error`.
- [ ] **Redelivery is harmless**: resend the last event from the provider
      dashboard - it answers 200 and nothing changes.
- [ ] **Bad signature is refused**: `curl -X POST -H 'content-type: application/json' -d '{}' .../api/billing/webhooks/stripe` -> 400.
- [ ] **Seats**: add a student (or deactivate one); within the hour (or after
      an API restart + 30s) the provider subscription quantity matches
      *billable users*.
- [ ] **Change plan** to flat and back; the provider shows the new price.
      (PayPal may ask the payer to approve a revision - see its section.)
- [ ] **Cancel** at period end, then **resume**; cancel again and fast-forward
      (Stripe test clock) past the period: the school turns read-only.
- [ ] **Portal** opens the provider's customer page (Stripe, Paddle; PayPal has none).
- [ ] **Failed renewal**: with the failing card, the school shows `past_due`
      and stays writable for `BILLING_GRACE_DAYS`, then turns read-only.

Invoice mode (WiPay, manual):

- [ ] Checkout with **manual**: an open `GB-YYYYMM-0001` invoice due in 14
      days, and the bank instructions with that number are shown.
- [ ] In `/platform` → Invoices, **Mark paid** (bank transfer, reference):
      the school becomes `active`, paid through one month after the trial.
- [ ] **Generate invoices** twice: the second run creates 0.
- [ ] Checkout / **Pay** an invoice with **WiPay**: hosted card page, approve
      card, browser returns to the billing page with `checkout=success`, the
      invoice is `paid` with method `wipay`. A declined card returns with
      `checkout=cancel` and the invoice stays open.
- [ ] Void an open invoice; marking a void or paid invoice paid is refused (409).

## 5. Read-only mode

- [ ] In `/platform`, set a school's state so it lapses (or wait for a trial
      end; on staging you can `UPDATE billing.subscription SET trial_ends_at = now() - interval '1 day', plan = NULL, provider = NULL WHERE school_id = '...'` and wait a minute for the cache).
- [ ] The teacher's create/edit actions fail with the toast "Your school's
      subscription has lapsed"; `POST` answers `402 { code: 'SUBSCRIPTION_REQUIRED' }`.
- [ ] Reads, sign-in/out and the admin's billing page still work.
- [ ] **Extend trial** (or **Comp**) from `/platform`: writes work again
      within a few seconds.

## 6. Platform dashboard

- [ ] A non-admin gets 404 on `/api/platform/overview`.
- [ ] Switch a provider off: it disappears from the school checkout; switching
      on one without credentials is refused (409).
- [ ] Overview MRR equals the active schools' plan prices.

## 7. Before production

- [ ] Switch every provider to live keys / `*_ENV=live|production` and
      register the live webhook endpoints (new secrets).
- [ ] `PAYMENT_PROVIDERS` lists only the providers you have live accounts for.
- [ ] `PLATFORM_ADMIN_EMAILS` lists only operators.
- [ ] `bun run smoke` against staging with billing on passes (it runs the
      manual-invoice flow end to end and restores the demo school).
