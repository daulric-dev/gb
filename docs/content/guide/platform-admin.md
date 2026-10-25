---
sidebar_label: Platform administration
sidebar_position: 10
---

# Platform administration

For operators of the hosted GradeBook platform - the people who run the service schools pay for. Self-hosted deployments have billing off (`BILLING_ENABLED` unset) and this dashboard answers 404.

## Who is a platform admin

A signed-in user is a platform admin when either:

- their verified account email is listed in `PLATFORM_ADMIN_EMAILS` (comma separated) on the backend, or
- they have a row in the `platform_admin` table.

Platform admins see **Platform admin** in the account menu (bottom of the sidebar), which opens `/platform`. Everyone else gets a 404 there. A platform admin does not need to belong to a school.

## Overview

`/platform` shows counts of schools, trialing, active, past due and read-only schools, and the monthly recurring revenue (MRR). Each tile links to the matching filtered list. If billing is on but Stripe is not configured, the overview warns that payments are not configured (schools cannot subscribe until it is).

## Schools

`/platform/schools` lists every school with its status, plan, billable users, trial end or renewal date and provider. Search by name and filter by status. Click a row for the detail page:

- **Subscription** - plan, provider, users, trial and period end.
- **Extend trial** - adds 1 to 365 days to the school's trial.
- **Comp until…** - marks the school active without payment until a date, with a note (pilots, discounts, goodwill).
- **Invoices** - the school's paid invoices, as recorded from Stripe.
- **Recent events** - payment provider notifications received for the school.

## Invoices

`/platform/invoices` lists invoices across all schools, filterable by status. Stripe raises and collects every invoice; each one Stripe reports as paid is recorded here, numbered `GB-YYYYMM-<seq>`, for history and reporting. The invoice itself (PDF, refunds, disputes) is managed in the Stripe dashboard, so there is no Void action here, and there is no way to record an offline payment (cheque, cash, wire) by hand. To let a school off a payment, **Comp** it instead. Older invoices from before billing went Stripe-only may still be listed.

## Payments

Payments go through **Stripe** only. There is no provider list or on/off switch: Stripe is offered to schools as soon as `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set on the backend. See [Billing providers](../billing-providers.md) for the Stripe dashboard setup (webhook endpoint and events, Customer Portal).

## Configuration reference

See [Environment variables](../environment-variables.md) for `BILLING_ENABLED`, `BILLING_PER_USER_CENTS`, `BILLING_FLAT_CENTS`, `BILLING_CURRENCY`, `BILLING_TRIAL_DAYS`, `BILLING_GRACE_DAYS`, `PLATFORM_ADMIN_EMAILS` and the Stripe keys.
