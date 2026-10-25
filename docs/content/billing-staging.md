---
label: Billing staging checklist
---

# Billing staging checklist

Everything to do before turning billing on in production, run first on a
staging deployment with Stripe in **test mode**. How billing works is in
[Billing](./backend/billing.md); Stripe dashboard setup is in
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
      STRIPE_SECRET_KEY=sk_test_...
      STRIPE_WEBHOOK_SECRET=whsec_...
      PLATFORM_ADMIN_EMAILS=you@example.com
      API_URL=https://api.staging.example.com
      APP_URL=https://staging.example.com
      ```
      ([Environment variables](./environment-variables.md#billing)).
- [ ] Restart. The API log has **no** "payments are not configured" warning,
      `GET /api/billing/status` as any user answers `enabled: true`, and
      `GET /api/billing` as a school admin lists Stripe in `providers` with
      `paymentsConfigured: true`.
- [ ] Without the Stripe keys the warning is logged, the billing page says
      payments are not configured yet, and checkout answers 503.

## 2. Webhook endpoint

Register `https://api.staging.example.com/api/billing/webhooks/stripe` in
Stripe test mode with the events listed in
[Billing providers](./billing-providers.md#dashboard-setup), and copy the
endpoint's `whsec_...` into `STRIPE_WEBHOOK_SECRET`. Configure the Customer
Portal in test mode too.

The webhook route must reach the API unmodified: no proxy that re-encodes
JSON bodies (signatures are checked over the exact bytes).

## 3. Test cards

| Approve | 3-D Secure | Decline / fail |
| --- | --- | --- |
| `4242 4242 4242 4242` | `4000 0025 0000 3155` | `4000 0000 0000 0341` attaches, fails at charge |

Any future expiry, any CVC.

## 4. End to end

Use a staging school with a school admin and a teacher.

- [ ] **Trial**: the admin sees *Settings → Billing* trialing with days left;
      the teacher sees the trial banner but no billing link.
- [ ] **Checkout** (per-user plan): pick the plan, **Continue to payment**,
      pay on Stripe Checkout with the approve card, returned to
      `/dashboard/settings/billing?checkout=success`.
- [ ] **Webhook arrives**: within seconds the summary shows `active` and a
      `currentPeriodEnd` a month out, and the paid invoice appears in the
      invoices list (and in `/platform/invoices`). The platform school detail
      lists the events; `billing.payment_event` rows have `processed_at` set
      and no `error`.
- [ ] **Redelivery is harmless**: resend the last event from the Stripe
      dashboard - it answers 200 and nothing changes.
- [ ] **Bad signature is refused**: `curl -X POST -H 'content-type: application/json' -d '{}' .../api/billing/webhooks/stripe` -> 400.
- [ ] **Seats**: add a student (or deactivate one); within the hour (or after
      an API restart + 30s) the Stripe subscription quantity matches
      *billable users*.
- [ ] **Change plan** to flat and back; Stripe shows the new price.
- [ ] **Cancel** at period end, then **resume**; cancel again and fast-forward
      (Stripe test clock) past the period: the school turns read-only.
- [ ] **Manage payment method & invoices** opens the Stripe Customer Portal,
      where the card can be changed and invoices downloaded.
- [ ] **Failed renewal**: with the failing card, the school shows `past_due`
      and stays writable for `BILLING_GRACE_DAYS`, then turns read-only.
- [ ] There is no offline payment: `POST /api/billing/checkout` with
      `provider: "manual"` answers 400, and invoices cannot be marked paid
      by hand.

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
- [ ] The overview shows payments as configured; MRR equals the active
      schools' plan prices.

## 7. Before production

- [ ] Switch to live keys (`sk_live_...`), register the live webhook endpoint
      (new `whsec_...`) and configure the live Customer Portal.
- [ ] `PLATFORM_ADMIN_EMAILS` lists only operators.
- [ ] `bun run smoke` against staging with billing on passes (it checks the
      school and platform routes, read-only mode and its recovery, and restores
      the demo school; a real checkout needs Stripe, so it is tested by hand
      above).
