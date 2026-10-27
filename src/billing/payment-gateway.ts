import { randomBytes } from 'crypto';

/** What the customer does next to pay: go to a hosted page, or scan a QR code shown in the app. */
export type PaymentAction =
  | { type: 'redirect'; url: string }
  | { type: 'qr'; imageUrl: string; expiresAt: string | null };

/** A charge's state at the provider, normalized. */
export interface ChargeState {
  status: 'pending' | 'succeeded' | 'failed';
  failureMessage?: string;
}

/**
 * The only surface billing needs from a payment provider. BillingService creates a charge, shows
 * the customer the returned action, and learns the outcome from a webhook or by polling
 * fetchCharge; either way the result ends up in BillingService.settleCharge.
 */
export interface PaymentGateway {
  readonly provider: string;

  createCharge(input: {
    /** Satang (THB minor units), as payment APIs expect. */
    amountSatang: number;
    currency: string;
    description: string;
    /** Where a hosted page sends the customer afterwards (redirect flows). */
    returnUrl: string;
    /** Stored on the charge so provider-side records point back to the invoice. */
    invoiceId: string;
  }): Promise<{ chargeId: string; action: PaymentAction }>;

  /** Current state at the provider. Absent when the provider can't be queried (mock). */
  fetchCharge?(chargeId: string): Promise<ChargeState>;

  /**
   * Test mode only: make the provider mark a charge paid or failed, so a QR payment can be
   * completed without a real bank app. Absent (or throws) outside test mode.
   */
  simulate?(chargeId: string, outcome: 'succeeded' | 'failed'): Promise<void>;
  readonly canSimulate: boolean;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Development stand-in for a hosted payment page: it sends the customer to the web app's
 * /billing/mock-checkout page, where they choose success or failure, and that page reports the
 * result through MockGatewayController as a real webhook would.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly provider = 'mock';
  readonly canSimulate = false; // the mock checkout page is the simulation

  constructor(private readonly appUrl: string) {}

  async createCharge(input: { returnUrl: string }) {
    const chargeId = `mock_chrg_${randomBytes(16).toString('hex')}`;
    const url = `${this.appUrl}/billing/mock-checkout/${chargeId}?return=${encodeURIComponent(input.returnUrl)}`;
    return { chargeId, action: { type: 'redirect' as const, url } };
  }
}
