import { subscriptionAccess, SubscriptionDates } from './subscription-access';

const NOW = new Date('2026-09-25T12:00:00Z');
const past = new Date('2026-09-24T12:00:00Z');
const future = new Date('2026-10-25T12:00:00Z');

const sub = (s: Partial<SubscriptionDates>): SubscriptionDates => ({
  status: 'trialing',
  trialEndsAt: null,
  currentPeriodEnd: null,
  canceledAt: null,
  ...s,
});

describe('subscriptionAccess', () => {
  it('treats a tenant without a subscription as expired', () => {
    expect(subscriptionAccess(null, NOW)).toEqual({ status: 'expired', readOnly: true });
  });

  it('allows writes during the trial and locks after it', () => {
    expect(subscriptionAccess(sub({ trialEndsAt: future }), NOW)).toEqual({ status: 'trialing', readOnly: false });
    expect(subscriptionAccess(sub({ trialEndsAt: past }), NOW)).toEqual({ status: 'expired', readOnly: true });
    expect(subscriptionAccess(sub({ trialEndsAt: null }), NOW)).toEqual({ status: 'expired', readOnly: true });
  });

  it('ends the trial exactly at its timestamp', () => {
    expect(subscriptionAccess(sub({ trialEndsAt: NOW }), NOW).readOnly).toBe(true);
  });

  it('allows writes inside a paid period, even when renewal is canceled', () => {
    expect(subscriptionAccess(sub({ status: 'active', currentPeriodEnd: future }), NOW)).toEqual({ status: 'active', readOnly: false });
    expect(subscriptionAccess(sub({ status: 'active', currentPeriodEnd: future, canceledAt: past }), NOW)).toEqual({
      status: 'active',
      readOnly: false,
    });
  });

  it('becomes past_due when an unpaid period ends, canceled when renewal was stopped', () => {
    expect(subscriptionAccess(sub({ status: 'active', currentPeriodEnd: past }), NOW)).toEqual({ status: 'past_due', readOnly: true });
    expect(subscriptionAccess(sub({ status: 'active', currentPeriodEnd: past, canceledAt: past }), NOW)).toEqual({
      status: 'canceled',
      readOnly: true,
    });
  });

  it('keeps stored terminal statuses read-only', () => {
    expect(subscriptionAccess(sub({ status: 'canceled' }), NOW)).toEqual({ status: 'canceled', readOnly: true });
    expect(subscriptionAccess(sub({ status: 'past_due', currentPeriodEnd: future }), NOW)).toEqual({ status: 'past_due', readOnly: true });
  });
});
