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

`/platform` shows counts of schools, trialing, active, past due and read-only schools, the monthly recurring revenue (MRR) and open invoices. Each tile links to the matching filtered list. **Generate invoices now** runs the invoice sweep instead of waiting for the daily run.

## Schools

`/platform/schools` lists every school with its status, plan, billable users, trial end or renewal date, provider and open invoices. Search by name and filter by status. Click a row for the detail page:

- **Subscription** - plan, provider, users, trial and period end.
- **Extend trial** - adds 1 to 365 days to the school's trial.
- **Comp until…** - marks the school active without payment until a date, with a note (pilots, discounts, goodwill).
- **Invoices** - the school's invoices, with Mark paid / Void.
- **Recent events** - payment provider notifications received for the school.

## Invoices

`/platform/invoices` lists invoices across all schools, filterable by status (open, paid, void, uncollectible). On an open invoice:

- **Mark paid** - record a payment received outside the platform: method (bank transfer, cheque, cash, other), an optional reference and note. The school's subscription is extended by a month and becomes active.
- **Void** - cancel the invoice (with an optional note) so it can no longer be paid.

Invoices are raised for schools on an invoice-mode provider (WiPay, manual): one per school per month, numbered `GB-YYYYMM-<seq>`, due in 14 days.

## Payment providers

`/platform/providers` lists every provider with two badges and a switch. A provider is offered to schools only when all three hold:

1. **Allowed by env** - listed in `PAYMENT_PROVIDERS` on the backend.
2. **Configured** - its credentials are set.
3. **Enabled** - the switch here is on (default on).

The switch is disabled, with a tooltip explaining why, when a provider is not allowed or not configured.

## Configuration reference

See [Environment variables](../environment-variables.md) for `BILLING_ENABLED`, `BILLING_PER_USER_CENTS`, `BILLING_FLAT_CENTS`, `BILLING_CURRENCY`, `BILLING_TRIAL_DAYS`, `BILLING_GRACE_DAYS`, `PAYMENT_PROVIDERS`, `PLATFORM_ADMIN_EMAILS` and each provider's credentials.
