import { OmiseApiError, OmisePaymentGateway, toChargeState } from './omise-gateway';

const { createFakeOmise } = require('../../tools/fake-omise.cjs');

const CHARGE = { amountSatang: 84530, currency: 'THB', description: 'INV-000001 แพ็กเกจ Pro 1 เดือน', returnUrl: 'http://app/billing', invoiceId: 'inv-1' };

describe('toChargeState', () => {
  it('maps Omise statuses', () => {
    expect(toChargeState({ status: 'successful' })).toEqual({ status: 'succeeded' });
    expect(toChargeState({ status: 'pending' })).toEqual({ status: 'pending' });
    expect(toChargeState({ status: 'expired' })).toEqual({ status: 'failed', failureMessage: 'PromptPay QR expired' });
    expect(toChargeState({ status: 'failed', failure_code: 'payment_rejected', failure_message: 'rejected' })).toEqual({
      status: 'failed',
      failureMessage: 'rejected',
    });
    expect(toChargeState({ status: 'reversed' })).toEqual({ status: 'failed', failureMessage: 'Charge reversed' });
  });
});

describe('OmisePaymentGateway', () => {
  it('only accepts secret keys and allows simulation with test keys only', () => {
    expect(() => new OmisePaymentGateway('pkey_test_abc')).toThrow(/secret key/);
    expect(new OmisePaymentGateway('skey_test_abc').canSimulate).toBe(true);
    expect(new OmisePaymentGateway('skey_live_abc').canSimulate).toBe(false);
  });

  it('sends Basic auth with the secret key and a PromptPay charge body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ object: 'charge', id: 'chrg_1', status: 'pending', expires_at: '2026-09-26T00:00:00Z', source: { type: 'promptpay', scannable_code: { image: { download_uri: 'https://qr/1.svg' } } } }),
        { status: 200 },
      ),
    );
    const gateway = new OmisePaymentGateway('skey_test_123', 'https://api.omise.co/', fetchMock);
    const result = await gateway.createCharge(CHARGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.omise.co/charges');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('skey_test_123:').toString('base64')}`);
    expect(JSON.parse(init.body)).toEqual({
      amount: 84530,
      currency: 'thb',
      source: { type: 'promptpay' },
      description: CHARGE.description,
      metadata: { invoice_id: 'inv-1' },
    });
    expect(result).toEqual({ chargeId: 'chrg_1', action: { type: 'qr', imageUrl: 'https://qr/1.svg', expiresAt: '2026-09-26T00:00:00Z' } });
  });

  it('turns Omise error objects into OmiseApiError', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ object: 'error', code: 'authentication_failure', message: 'authentication failed' }), { status: 401 }),
    );
    const err = await new OmisePaymentGateway('skey_test_x', 'https://api.omise.co', fetchMock).fetchCharge('chrg_1').catch((e) => e);
    expect(err).toBeInstanceOf(OmiseApiError);
    expect(err).toMatchObject({ status: 401, code: 'authentication_failure' });
  });

  describe('against the fake Omise server (real HTTP)', () => {
    let fake: { listen(port?: number): Promise<string>; close(): Promise<void> };
    let gateway: OmisePaymentGateway;

    beforeAll(async () => {
      fake = createFakeOmise();
      gateway = new OmisePaymentGateway('skey_test_ci', await fake.listen(0));
    });
    afterAll(() => fake.close());

    it('creates a pending PromptPay charge with a QR image', async () => {
      const { chargeId, action } = await gateway.createCharge(CHARGE);
      expect(chargeId).toMatch(/^chrg_test_/);
      expect(action.type).toBe('qr');
      const qr = await fetch((action as { imageUrl: string }).imageUrl);
      expect(qr.headers.get('content-type')).toBe('image/svg+xml');
      await expect(gateway.fetchCharge(chargeId)).resolves.toEqual({ status: 'pending' });
    });

    it('marks charges paid or failed in test mode', async () => {
      const paid = await gateway.createCharge(CHARGE);
      await gateway.simulate(paid.chargeId, 'succeeded');
      await expect(gateway.fetchCharge(paid.chargeId)).resolves.toEqual({ status: 'succeeded' });

      const failed = await gateway.createCharge(CHARGE);
      await gateway.simulate(failed.chargeId, 'failed');
      await expect(gateway.fetchCharge(failed.chargeId)).resolves.toMatchObject({ status: 'failed' });
    });

    it('rejects a wrong key and an unknown charge like Omise does', async () => {
      const bad = new OmisePaymentGateway('skey_live_nope', (gateway as unknown as { apiUrl: string }).apiUrl);
      await expect(bad.createCharge(CHARGE)).rejects.toMatchObject({ status: 401, code: 'authentication_failure' });
      await expect(gateway.fetchCharge('chrg_test_missing')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    });
  });
});
