---
sidebar_label: Billing and your subscription
sidebar_position: 9
---

# Billing and your subscription

This page is for school administrators on the **hosted** GradeBook platform. If your school runs its own (self-hosted) copy of GradeBook, billing is switched off: there is no trial, nothing is ever read-only, and none of the screens below appear.

## Plans

Every plan includes every feature. You pick one of two:

| Plan | Price | Best for |
| --- | --- | --- |
| **Per user** | $5 per billable user per month | Smaller schools |
| **Flat** | $300 per month, unlimited users | Schools with more than 60 users (at these prices) |

A **billable user** is every active student and every active staff member in your school. Inactive students and people who have left do not count. You are always billed for at least one user.

The billing page shows your current count and what each plan would cost you right now, so you can compare before choosing. (The prices shown there come from the platform and are the ones that apply.)

## The free trial

A new school gets a **30-day free trial** with everything. While it runs, administrators and staff see a banner with the days left; administrators get a **Choose a plan** link.

You can choose a plan at any time during the trial.

## When the subscription lapses: read-only

If the trial ends without a plan, or a subscription is canceled, goes unpaid, or stays past due for more than 7 days, the school becomes **read-only**:

- Everyone can still sign in and **view** everything - courses, grades, files, messages.
- Nobody can **change** anything. Saving shows "Your school's subscription has lapsed - the platform is read-only".
- Administrators see a **Renew** link in the banner; everyone else is told to ask an administrator.
- Billing itself always works, so you can pay to unlock the school.

As soon as a payment goes through, the school is writable again.

## Paying

Open **Settings → Billing** (or **Billing** in the Admin section of the sidebar). Only administrators (anyone allowed to manage the school's settings) can see it.

1. Pick **Per user** or **Flat**.
2. Click **Continue to payment**. You are sent to **Stripe**'s secure checkout page to enter your card - GradeBook never sees your card details. After paying you come back to the billing page; it refreshes on its own. The subscription renews automatically each month.

If the page says **payments are not configured yet**, the platform has not finished setting up payments: contact support. Your trial and data are not affected.

### Changing plan, canceling, payment method

- **Switch to the … plan** changes plan; Stripe prorates the difference on your next invoice.
- **Cancel subscription** cancels at the end of the period you have paid for. Until then everything works, and the page shows when it will end. **Resume subscription** undoes it.
- **Manage payment method & invoices** opens Stripe's customer portal, where you can update your card and download invoices and receipts.

## Invoices

Stripe bills you each month for the plan price (per-user plans at the number of users counted at the time; changes during the month are prorated). Each paid invoice is listed in the **Invoices** table on the billing page, numbered `GB-YYYYMM-…`, with period, users, amount and paid date. The invoice PDFs and receipts themselves are in Stripe's portal (**Manage payment method & invoices**).

If a renewal payment fails, the school shows **Past due** and stays writable for 7 days while Stripe retries; update your card in the portal to fix it.

## In the mobile app

The app shows the read-only notice on the home screen when it applies, and a single message if a change is refused. Billing is managed on the web.
