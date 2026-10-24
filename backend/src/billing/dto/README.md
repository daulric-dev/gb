# Billing DTOs (`src/billing/dto`)

All the billing and platform request bodies are in `billing.dto.ts`. They are validated by the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) and documented in Swagger.

## Classes and constants in `billing.dto.ts`

| Class | Used by | Validation |
|-------|---------|------------|
| `CheckoutDto` | `POST /api/billing/checkout` | `plan`: `'per_user'` or `'flat'`. `provider`: a string of at most 40 characters, a provider id such as `manual`. Whether that provider is enabled is checked in `BillingService`, which answers 400 when it is not. |
| `ChangePlanDto` | `POST /api/billing/change-plan` | `plan`: `'per_user'` or `'flat'`. |
| `PayInvoiceDto` | `POST /api/billing/invoices/:id/pay` | `provider`: a string of at most 40 characters, for example `wipay`. |
| `ExtendTrialDto` | `POST /api/platform/schools/:schoolId/extend-trial` | `days`: an integer from 1 to 365. `@Type(() => Number)` coerces numeric strings. |
| `CompDto` | `POST /api/platform/schools/:schoolId/comp` | `until`: an ISO date string. `note`: optional, at most 1000 characters. |
| `MarkPaidDto` | `POST /api/platform/invoices/:id/mark-paid` | `method`: one of `MARK_PAID_METHODS` (`bank_transfer`, `cheque`, `cash`, `other`). `reference`: optional, at most 200 characters. `note`: optional, at most 1000 characters. |
| `VoidInvoiceDto` | `POST /api/platform/invoices/:id/void` | `note`: optional, at most 1000 characters. |
| `SetProviderDto` | `PATCH /api/platform/providers/:id` | `enabled`: boolean. |

| Constant | Used by |
|----------|---------|
| `MARK_PAID_METHODS` | `MarkPaidDto`. It mirrors `MarkPaidMethod` in `../invoice.service.ts`. |
| `INVOICE_STATUSES` (`open`, `paid`, `void`, `uncollectible`) | `PlatformController.invoices()` uses it to accept only a known `?status=` filter. |

The plan list here (`['per_user', 'flat']`) duplicates `PLANS` in `../billing.config.ts`. If you add a plan, update both, along with `BillingPlan` in `../providers/payment-provider.ts`.

## Adding a DTO

1. Add a class to `billing.dto.ts` with `class-validator` decorators and `@ApiProperty` / `@ApiPropertyOptional` on each field. Use `@Type(() => Number)` for numbers that may arrive as strings.
2. Use it as the `@Body()` type in `../billing.controller.ts` or `../platform.controller.ts`.
3. Pass the fields on to the service method. Controllers pass individual fields, not the whole DTO.
