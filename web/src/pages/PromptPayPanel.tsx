import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatMoney } from '../format';
import { Alert, Button, Card } from '../ui';

interface Props {
  invoiceId: string;
  invoiceNo: string;
  amount: number;
  imageUrl: string;
  expiresAt: string | null;
  /** Test-mode gateway: show buttons that complete the payment without a bank app. */
  canSimulate: boolean;
  /** Called once the payment is final (paid or failed). */
  onSettled(result: 'paid' | 'failed'): void;
}

interface PaymentState {
  invoiceStatus: 'draft' | 'open' | 'paid' | 'void';
  paymentStatus: 'pending' | 'succeeded' | 'failed';
}

const POLL_MS = 3000;

/**
 * PromptPay QR for an open invoice. Polls the API, which re-checks the charge with the payment
 * provider, so the page updates even if the provider's webhook is slow or can't reach this server.
 */
export default function PromptPayPanel({ invoiceId, invoiceNo, amount, imageUrl, expiresAt, canSimulate, onSettled }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const state = await api<PaymentState>(`/billing/invoices/${invoiceId}/refresh`, { method: 'POST' });
        if (stopped) return;
        if (state.invoiceStatus === 'paid') onSettled('paid');
        else if (state.paymentStatus === 'failed') onSettled('failed');
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      }
    };
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [invoiceId, onSettled]);

  async function simulate(outcome: 'succeeded' | 'failed') {
    setSimulating(true);
    setError(null);
    try {
      const state = await api<PaymentState>(`/billing/invoices/${invoiceId}/simulate`, { method: 'POST', body: { outcome } });
      onSettled(state.invoiceStatus === 'paid' ? 'paid' : 'failed');
    } catch (err) {
      setError((err as Error).message);
      setSimulating(false);
    }
  }

  return (
    <Card className="mb-6 flex flex-wrap items-center gap-6 border-emerald-200 p-5">
      <img src={imageUrl} alt={`PromptPay QR สำหรับ ${invoiceNo}`} className="h-56 w-auto rounded-md border border-slate-200 bg-white" />
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-semibold">สแกนจ่ายด้วย PromptPay</h2>
        <p className="text-sm text-slate-600">เปิดแอปธนาคาร สแกน QR นี้ แล้วยืนยันการชำระเงิน หน้านี้จะอัปเดตเองเมื่อได้รับเงิน</p>
        <div className="text-2xl font-semibold tabular-nums">{formatMoney(amount)} บาท</div>
        <div className="text-sm text-slate-500">
          ใบแจ้งหนี้ {invoiceNo}
          {expiresAt && ` · QR ใช้ได้ถึง ${new Date(expiresAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`}
        </div>
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-600" /> รอการชำระเงิน…
        </div>
        {error && <Alert>{error}</Alert>}
        {canSimulate && (
          <div className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 text-xs text-amber-900">โหมดทดสอบ: ยังไม่มีการตัดเงินจริง จำลองผลการชำระเงินได้</div>
            <div className="flex flex-wrap gap-2">
              <Button className="px-3 py-1.5 text-xs" disabled={simulating} onClick={() => void simulate('succeeded')}>
                จำลอง: ชำระสำเร็จ
              </Button>
              <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={simulating} onClick={() => void simulate('failed')}>
                จำลอง: ชำระไม่สำเร็จ
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
