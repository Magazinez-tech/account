import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { formatMoney } from '../format';
import { Alert, Button, Card, Loading } from '../ui';
import { useApi } from '../useApi';

interface Charge {
  chargeId: string;
  status: 'pending' | 'succeeded' | 'failed';
  amount: number;
  currency: string;
  description: string;
  merchantCustomer: string;
}

/** Only follow return URLs back into this app, so the page can't be used as an open redirect. */
function safeReturn(url: string | null): string {
  if (url && url.startsWith(`${window.location.origin}/`)) return url;
  return '/billing';
}

/**
 * Development stand-in for a payment provider's hosted checkout (PAYMENT_PROVIDER=mock).
 * Deliberately looks different from the app so it reads as "another site".
 */
export default function MockCheckoutPage() {
  const { chargeId = '' } = useParams();
  const [params] = useSearchParams();
  const returnUrl = safeReturn(params.get('return'));
  const { data: charge, error } = useApi<Charge>(`/billing/mock/charges/${encodeURIComponent(chargeId)}`, { auth: false });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function complete(outcome: 'succeeded' | 'failed') {
    setBusy(true);
    setSubmitError(null);
    try {
      await api(`/billing/mock/charges/${encodeURIComponent(chargeId)}/complete`, {
        method: 'POST',
        auth: false,
        body: outcome === 'failed' ? { outcome, failureMessage: 'Card declined (mock)' } : { outcome },
      });
      window.location.assign(returnUrl);
    } catch (err) {
      setSubmitError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-800 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-4 text-center text-sm font-semibold uppercase tracking-widest text-slate-300">Mock Payment Gateway</div>
        <Card className="p-6">
          <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">หน้าจำลองสำหรับทดสอบเท่านั้น ไม่มีการตัดเงินจริง</div>
          {error && <Alert>{error}</Alert>}
          {!charge && !error && <Loading />}
          {charge && (
            <>
              <div className="text-sm text-slate-500">{charge.merchantCustomer}</div>
              <div className="mt-1 text-sm">{charge.description}</div>
              <div className="mt-4 text-3xl font-semibold tabular-nums">
                {formatMoney(charge.amount)} <span className="text-base font-normal text-slate-500">{charge.currency}</span>
              </div>
              {submitError && (
                <div className="mt-4">
                  <Alert>{submitError}</Alert>
                </div>
              )}
              {charge.status === 'pending' ? (
                <div className="mt-6 space-y-2">
                  <Button className="w-full" disabled={busy} onClick={() => void complete('succeeded')}>
                    ชำระเงินสำเร็จ
                  </Button>
                  <Button className="w-full" variant="danger" disabled={busy} onClick={() => void complete('failed')}>
                    จำลองการชำระไม่สำเร็จ
                  </Button>
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  <Alert tone={charge.status === 'succeeded' ? 'success' : 'error'}>
                    รายการนี้{charge.status === 'succeeded' ? 'ชำระสำเร็จ' : 'ไม่สำเร็จ'}ไปแล้ว
                  </Alert>
                  <Button className="w-full" variant="secondary" onClick={() => window.location.assign(returnUrl)}>
                    กลับไปที่ร้านค้า
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
