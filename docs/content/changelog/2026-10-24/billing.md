---
sidebar_label: 2026-10-24 · SaaS billing
sidebar_position: 1
---

# 2026-10-24 - SaaS billing for the hosted platform

Schools can now pay for the hosted GradeBook platform. **Self-hosted
deployments are unaffected: billing is off unless `BILLING_ENABLED=true`, and
they should leave it unset.**

## What schools get

- A **30-day free trial** with everything (existing schools get it from the
  day billing is turned on, not from when they were created).
- Two plans: **per user** ($5 per active staff member or student per month)
  or **flat** ($300 per month, unlimited users). Prices, currency, trial and
  grace period are configurable.
- *Settings → Billing* for school admins (`school:update`): plan picker, the
  payment providers the operator offers, seats and estimate, invoices with
  Pay buttons, cancel/resume, the provider's billing portal.
- After the trial, or when a subscription lapses (canceled past its period,
  unpaid, past due beyond 7 days), the school is **read-only**: reads work,
  changes answer `402 SUBSCRIPTION_REQUIRED`. Sign-in, billing and read
  markers keep working.

## Payment providers

Stripe, PayPal and Paddle (subscriptions), WiPay (Caribbean card payments per
invoice) and manual bank-transfer invoices marked paid by an operator. The
operator chooses with `PAYMENT_PROVIDERS`, credentials, and on/off switches in
the platform dashboard. See [Billing providers](../../billing-providers.md).

## Platform dashboard

`/platform` for platform admins (`PLATFORM_ADMIN_EMAILS` or
`billing.platform_admin`): overview with MRR, schools with search and status,
school detail with invoices and events, extend trial, comp, invoices with Mark
paid / Void, provider switches, Generate invoices.

## Deploying

- Migration `20261024100000_billing` adds the `billing` schema
  (`subscription`, `invoice`, `payment_event`, `provider_setting`,
  `platform_admin`). `bun run db:deploy`; nothing to backfill.
- New permission catalog key `school:update` (admins hold it by default; it
  can be granted through custom roles).
- New environment variables, all optional and inert without
  `BILLING_ENABLED`: see [Environment variables](../../environment-variables.md#billing).
- Webhooks: `${API_URL}/api/billing/webhooks/<provider>`; the API keeps the raw
  body for that route only.
- Before launch, work through the [staging checklist](../../billing-staging.md).

Details: [Billing](../../backend/billing.md).
