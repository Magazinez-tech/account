import { ChargeState, PaymentAction, PaymentGateway } from './payment-gateway';

/** The parts of an Omise charge object this integration reads. */
interface OmiseCharge {
  object: 'charge';
  id: string;
  status: 'pending' | 'successful' | 'failed' | 'expired' | 'reversed';
  failure_code?: string | null;
  failure_message?: string | null;
  expires_at?: string | null;
  source?: { type: string; scannable_code?: { image?: { download_uri?: string } } } | null;
}

interface OmiseError {
  object: 'error';
  code: string;
  message: string;
}

export class OmiseApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`Omise ${status} ${code}: ${message}`);
  }
}

/** Omise statuses mapped to ours: only `successful` is paid; expired and reversed count as failed. */
export function toChargeState(charge: Pick<OmiseCharge, 'status' | 'failure_code' | 'failure_message'>): ChargeState {
  switch (charge.status) {
    case 'successful':
      return { status: 'succeeded' };
    case 'pending':
      return { status: 'pending' };
    case 'expired':
      return { status: 'failed', failureMessage: charge.failure_message ?? 'PromptPay QR expired' };
    default:
      return { status: 'failed', failureMessage: charge.failure_message ?? charge.failure_code ?? `Charge ${charge.status}` };
  }
}

/**
 * Omise (Opn Payments) PromptPay charges. The customer scans the QR from
 * charge.source.scannable_code; Omise then sends a charge.complete webhook, which is never trusted
 * as-is: the charge is re-fetched with the secret key (fetchCharge) before anything is settled.
 *
 * apiUrl is https://api.omise.co in production and the fake server (tools/fake-omise.cjs) in
 * development and CI.
 */
export class OmisePaymentGateway implements PaymentGateway {
  readonly provider = 'omise';
  readonly canSimulate: boolean;

  constructor(
    private readonly secretKey: string,
    private readonly apiUrl = 'https://api.omise.co',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^skey_(test_)?\w+/.test(secretKey)) throw new Error('OMISE_SECRET_KEY must be an Omise secret key (skey_...)');
    // mark_as_paid / mark_as_failed exist only for test-mode keys.
    this.canSimulate = secretKey.startsWith('skey_test_');
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        // Omise authenticates with HTTP Basic: the secret key as user name, empty password.
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as T | OmiseError | null;
    if (!res.ok || !json || (json as OmiseError).object === 'error') {
      const err = json as OmiseError | null;
      throw new OmiseApiError(res.status, err?.code ?? 'unknown', err?.message ?? res.statusText);
    }
    return json as T;
  }

  async createCharge(input: { amountSatang: number; currency: string; description: string; invoiceId: string }) {
    const charge = await this.request<OmiseCharge>('POST', '/charges', {
      amount: input.amountSatang,
      currency: input.currency.toLowerCase(),
      source: { type: 'promptpay' },
      description: input.description,
      metadata: { invoice_id: input.invoiceId },
    });
    const imageUrl = charge.source?.scannable_code?.image?.download_uri;
    if (!imageUrl) throw new OmiseApiError(502, 'missing_qr', `Charge ${charge.id} has no PromptPay QR code`);
    const action: PaymentAction = { type: 'qr', imageUrl, expiresAt: charge.expires_at ?? null };
    return { chargeId: charge.id, action };
  }

  async fetchCharge(chargeId: string): Promise<ChargeState> {
    return toChargeState(await this.request<OmiseCharge>('GET', `/charges/${encodeURIComponent(chargeId)}`));
  }

  async simulate(chargeId: string, outcome: 'succeeded' | 'failed') {
    if (!this.canSimulate) throw new Error('Payment simulation needs an Omise test key');
    await this.request('POST', `/charges/${encodeURIComponent(chargeId)}/${outcome === 'succeeded' ? 'mark_as_paid' : 'mark_as_failed'}`);
  }
}
