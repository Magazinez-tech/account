/** Window event fired after the subscription changes in place, so the header's plan line refreshes. */
export const BILLING_CHANGED = 'billing:changed';

export const announceBillingChanged = () => window.dispatchEvent(new Event(BILLING_CHANGED));
