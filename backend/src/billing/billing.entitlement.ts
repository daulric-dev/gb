import { DAY_MS } from './billing.config';
import type { SubscriptionStatus } from './providers/payment-provider';

/** What the API reports: the stored status, or `read_only` once lapsed. */
export type DisplayStatus = SubscriptionStatus | 'read_only';

export interface EntitlementInput {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  compUntil: Date | null;
  /** The provider's mode, when the school has picked one. */
  mode: 'subscription' | 'invoice' | null;
  /** Due date of the oldest open invoice (invoice-mode providers). */
  oldestOpenDueAt: Date | null;
}

export interface Entitlement {
  status: DisplayStatus;
  readOnly: boolean;
}

const after = (d: Date | null, now: Date) => !!d && d.getTime() > now.getTime();

/**
 * Whether a school may write, from its subscription row.
 *
 * - Complimentary access (comp_until in the future) and the school's own
 *   trial always allow writes.
 * - A paid period allows writes until it ends; a missed renewal gets
 *   `graceDays` more (past_due, or an active row whose renewal never arrived),
 *   a cancellation does not.
 * - Invoice-mode schools also lapse when an open invoice is unpaid `graceDays`
 *   past its due date - and an open invoice not yet that late keeps them
 *   writable, so a school can pay by transfer after its trial runs out.
 */
export function computeEntitlement(
  input: EntitlementInput,
  now: Date,
  graceDays: number,
): Entitlement {
  const grace = graceDays * DAY_MS;
  const status = (input.status || 'trialing') as SubscriptionStatus;
  const plus = (d: Date | null, ms: number) =>
    d ? new Date(d.getTime() + ms) : null;

  if (after(input.compUntil, now)) return { status: 'active', readOnly: false };

  const inTrial = after(input.trialEndsAt, now);

  if (input.mode === 'invoice' && input.oldestOpenDueAt) {
    const lapsed = !after(plus(input.oldestOpenDueAt, grace), now);
    if (lapsed && !inTrial) return { status: 'read_only', readOnly: true };
    const late = !after(input.oldestOpenDueAt, now);
    const shown: SubscriptionStatus =
      late && status === 'active' ? 'past_due' : status;
    return { status: shown, readOnly: false };
  }

  if (inTrial) return { status, readOnly: false };

  let writable: boolean;
  switch (status) {
    case 'active':
      writable =
        input.currentPeriodEnd === null
          ? input.mode !== 'invoice'
          : after(
              plus(input.currentPeriodEnd, input.cancelAtPeriodEnd ? 0 : grace),
              now,
            );
      break;
    case 'past_due':
      writable = after(plus(input.currentPeriodEnd, grace), now);
      break;
    case 'canceled':
      writable = after(input.currentPeriodEnd, now);
      break;
    case 'trialing':
      // A provider-side trial (subscription started during ours) runs to its
      // period end.
      writable = after(input.currentPeriodEnd, now);
      break;
    case 'unpaid':
    case 'incomplete':
    default:
      writable = false;
  }

  return writable
    ? { status, readOnly: false }
    : { status: 'read_only', readOnly: true };
}

/** When a lazily created row's trial ends: never before now + trialDays. */
export function initialTrialEnd(
  schoolCreatedAt: Date | null,
  now: Date,
  trialDays: number,
): Date {
  const start =
    schoolCreatedAt && schoolCreatedAt.getTime() > now.getTime()
      ? schoolCreatedAt
      : now;
  return new Date(start.getTime() + trialDays * DAY_MS);
}
