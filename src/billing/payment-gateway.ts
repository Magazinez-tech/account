import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * The only surface billing needs from a payment provider. A real provider (Omise, Stripe) creates
 * a charge, sends the customer to its hosted page (authorizeUri), and later reports the result by
 * webhook, which ends up in BillingService.settleCharge.
 */
export interface PaymentGateway {
  readonly provider: string;
  createCharge(input: {
    /** Satang (THB minor units), as payment APIs expect. */
    amountSatang: number;
    currency: string;
    description: string;
    /** Where the provider sends the customer after paying. */
    returnUrl: string;
  }): Promise<{ chargeId: string; authorizeUri: string }>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Development stand-in for a hosted payment page: it sends the customer to the web app's
 * /billing/mock-checkout page, where they choose success or failure, and that page reports the
 * result through MockGatewayController as a real webhook would.
 */
@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly provider = 'mock';

  constructor(private readonly appUrl: string) {}

  async createCharge(input: { returnUrl: string }) {
    const chargeId = `mock_chrg_${randomBytes(16).toString('hex')}`;
    const authorizeUri = `${this.appUrl}/billing/mock-checkout/${chargeId}?return=${encodeURIComponent(input.returnUrl)}`;
    return { chargeId, authorizeUri };
  }
}
