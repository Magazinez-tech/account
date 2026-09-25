import { SetMetadata } from '@nestjs/common';

/**
 * What a tenant may do right now. There is no scheduler: expiry is derived from the stored dates
 * whenever it's needed, so a trial or period ends exactly when its timestamp passes.
 */
export type EffectiveStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface SubscriptionDates {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}

export function subscriptionAccess(sub: SubscriptionDates | null | undefined, now = new Date()): { status: EffectiveStatus; readOnly: boolean } {
  if (!sub) return { status: 'expired', readOnly: true };
  if (sub.status === 'trialing') {
    return sub.trialEndsAt && sub.trialEndsAt > now ? { status: 'trialing', readOnly: false } : { status: 'expired', readOnly: true };
  }
  if (sub.status === 'active') {
    if (sub.currentPeriodEnd && sub.currentPeriodEnd > now) return { status: 'active', readOnly: false };
    // Period over: canceled on purpose, or unpaid renewal.
    return { status: sub.canceledAt ? 'canceled' : 'past_due', readOnly: true };
  }
  return { status: sub.status === 'canceled' ? 'canceled' : 'past_due', readOnly: true };
}

const ALLOW_READ_ONLY_KEY = 'allowWhenReadOnly';

/**
 * Lets writes through while the tenant is read-only (trial over, unpaid). Billing needs it so a
 * locked-out tenant can still pay.
 */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_READ_ONLY_KEY, true);
export { ALLOW_READ_ONLY_KEY };
