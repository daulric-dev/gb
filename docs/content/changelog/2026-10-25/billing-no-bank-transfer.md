---
sidebar_label: 2026-10-25 · Billing: online payments only
sidebar_position: 3
---

# 2026-10-25 - Billing: bank transfer and "Mark paid" removed

Schools now pay only through the online payment providers: **Stripe, PayPal,
Paddle and WiPay**. The manual (bank transfer, cheque, cash) option added with
[SaaS billing](../2026-10-24/billing.md) is gone, because recording offline
payments by hand made the billing process harder to run and to reason about.
Self-hosted deployments are unaffected (billing stays off unless
`BILLING_ENABLED=true`).

## What changed

- **`manual` provider removed.** `backend/src/billing/providers/manual.provider.ts`
  and its tests are deleted and it is no longer registered, so it never
  appears in the school's **Pay with** list or in `/platform/providers`.
  `POST /api/billing/checkout` (and `POST /api/billing/invoices/:id/pay`) with
  `provider: "manual"` answers **400**, like any provider that is not offered,
  and `/api/billing/webhooks/manual` answers 404.
- **"Mark paid" removed.** `POST /api/platform/invoices/:id/mark-paid`,
  `MarkPaidDto`, `MARK_PAID_METHODS` and `InvoiceService.markPaid()` are gone,
  as is the **Mark paid** dialog in the platform dashboard. Operators keep
  **Void**, **Extend trial**, **Comp**, **Generate invoices** and the provider
  switches. To let a school off a payment, comp it.
- **No payment instructions.** `CheckoutResult.instructions` and the
  `instructions` field of the checkout / pay responses (only manual used them)
  are removed; the answer is always `{ redirectUrl }`. The web billing page's
  "How to pay" dialog is removed.
- WiPay, the remaining invoice-mode provider, is unchanged: its callback marks
  the invoice paid (`InvoiceService.markPaidByProvider()`) and the school
  becomes active.
- The Terms of Service (`/terms`) now say payments are made online through
  the provider the school chooses, with no bank transfers, cheques or cash.

## Deploy

- Remove `manual` from `PAYMENT_PROVIDERS` and delete
  `BILLING_MANUAL_INSTRUCTIONS` from the API's environment (an unknown id in
  `PAYMENT_PROVIDERS` is simply ignored, so leaving it does no harm).
- No migration. The `billing.invoice` columns `method`, `reference`, `note`
  and `marked_by` stay (no constraint lists `manual` or the offline methods);
  `marked_by` is no longer written.
- **Existing manual rows:** a school whose subscription has
  `provider = 'manual'` is no longer invoiced by the sweep. It keeps access
  until its paid-through date (or trial end) and must then check out with an
  online provider. An open manual invoice can still be paid online from the
  billing page (**Pay** with WiPay) or voided by an operator.

## Tests

`bun test src/billing` drops the manual provider and mark-paid tests; invoice
payment is covered through `markPaidByProvider()`. `bun run smoke` no longer
drives a manual checkout: it checks that `manual` is refused at checkout and
that mark-paid is gone, plus the school and platform routes, read-only mode
and recovery by extend-trial and comp.
