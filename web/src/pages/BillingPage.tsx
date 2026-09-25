import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type BillingOverview, type PaymentAction, type SubscriptionStatus } from '../api';
import { formatDate, formatMoney } from '../format';
import { Alert, Badge, Button, Card, cx, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';
import { announceBillingChanged } from '../billing-events';
import PromptPayPanel from './PromptPayPanel';

const STATUS: Record<SubscriptionStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  trialing: { label: 'ทดลองใช้', tone: 'amber' },
  active: { label: 'ใช้งาน', tone: 'green' },
  past_due: { label: 'ค้างชำระ', tone: 'red' },
  canceled: { label: 'ยกเลิกแล้ว', tone: 'slate' },
  expired: { label: 'หมดช่วงทดลอง', tone: 'red' },
};

const INVOICE_STATUS = {
  draft: { label: 'ร่าง', tone: 'slate' },
  open: { label: 'รอชำระ', tone: 'amber' },
  paid: { label: 'ชำระแล้ว', tone: 'green' },
  void: { label: 'ยกเลิก', tone: 'slate' },
} as const;

const dateOf = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : '—');

/** Result banner after the gateway sends the customer back with ?invoice=<id>. Polls while pending. */
function PaymentResult({ overview, invoiceId, reload }: { overview: BillingOverview; invoiceId: string; reload(): void }) {
  const invoice = overview.invoices.find((i) => i.id === invoiceId);
  const pending = invoice?.status === 'open' && invoice.paymentStatus === 'pending';

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(reload, 2000);
    return () => clearTimeout(t);
  }, [pending, overview, reload]);

  if (!invoice) return null;
  if (invoice.status === 'paid') {
    return <Alert tone="success">ชำระเงินใบแจ้งหนี้ {invoice.invoiceNo} สำเร็จ ขอบคุณที่ใช้บริการ</Alert>;
  }
  if (invoice.paymentStatus === 'failed') {
    return <Alert>ชำระเงินใบแจ้งหนี้ {invoice.invoiceNo} ไม่สำเร็จ กรุณาเลือกแพ็กเกจแล้วลองใหม่อีกครั้ง</Alert>;
  }
  return <Alert tone="success">กำลังรอผลการชำระเงิน {invoice.invoiceNo}…</Alert>;
}

export default function BillingPage() {
  const { data, error, loading, reload } = useApi<BillingOverview>('/billing');
  const [params, setParams] = useSearchParams();
  const returnedInvoice = params.get('invoice');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function checkout(planCode: string) {
    setBusy(planCode);
    setActionError(null);
    try {
      const res = await api<{ invoiceId: string; payment: PaymentAction }>('/billing/checkout', { method: 'POST', body: { planCode } });
      if (res.payment.type === 'redirect') {
        // Off to the payment provider's page; it sends the customer back to /billing?invoice=...
        window.location.assign(res.payment.url);
        return;
      }
      // PromptPay: the open invoice now carries its QR; the panel below shows it.
      setParams({});
      reload();
      setBusy(null);
    } catch (err) {
      setActionError((err as Error).message);
      setBusy(null);
    }
  }

  // A QR payment settled: show the same result banner as a redirect return, then refresh.
  const onQrSettled = useCallback(
    (invoiceId: string) => {
      setParams({ invoice: invoiceId });
      reload();
      announceBillingChanged();
    },
    [setParams, reload],
  );

  async function toggleRenewal(action: 'cancel' | 'resume') {
    if (action === 'cancel' && !confirm('ยกเลิกการต่ออายุ? ยังใช้งานได้ตามปกติจนถึงวันสิ้นสุดรอบที่ชำระแล้ว')) return;
    setActionError(null);
    try {
      await api(`/billing/${action}`, { method: 'POST' });
      reload();
      announceBillingChanged();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const status = STATUS[data.status];
  const qrInvoice = data.invoices.find((i) => i.status === 'open' && i.paymentAction?.type === 'qr');
  const isPaid = data.status === 'active';

  return (
    <>
      <PageHeader title="การชำระเงิน" subtitle="แพ็กเกจ ใบแจ้งหนี้ และการต่ออายุ" />
      <div className="space-y-4">
        {returnedInvoice && <PaymentResult overview={data} invoiceId={returnedInvoice} reload={reload} />}
        {actionError && <Alert>{actionError}</Alert>}
      </div>

      <Card className="my-6 flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div>
          <div className="text-xs text-slate-500">แพ็กเกจปัจจุบัน</div>
          <div className="mt-0.5 flex items-center gap-2 text-lg font-semibold">
            {data.plan?.name ?? '—'} <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        </div>
        <div className="text-sm">
          {data.status === 'trialing' && <>ทดลองใช้ถึง {dateOf(data.trialEndsAt)}</>}
          {isPaid && (data.cancelAtPeriodEnd ? <>ใช้งานได้ถึง {dateOf(data.currentPeriodEnd)} (ไม่ต่ออายุ)</> : <>ต่ออายุรอบถัดไป {dateOf(data.currentPeriodEnd)}</>)}
          {data.readOnly && <span className="text-red-700">โหมดอ่านอย่างเดียว เลือกแพ็กเกจด้านล่างเพื่อชำระและใช้งานต่อ</span>}
        </div>
        {isPaid && (
          <div className="ml-auto">
            {data.cancelAtPeriodEnd ? (
              <Button variant="secondary" onClick={() => void toggleRenewal('resume')}>
                ต่ออายุอัตโนมัติอีกครั้ง
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void toggleRenewal('cancel')}>
                ยกเลิกการต่ออายุ
              </Button>
            )}
          </div>
        )}
      </Card>

      {qrInvoice && qrInvoice.paymentAction && (
        <PromptPayPanel
          key={qrInvoice.id}
          invoiceId={qrInvoice.id}
          invoiceNo={qrInvoice.invoiceNo}
          amount={qrInvoice.amount}
          imageUrl={qrInvoice.paymentAction.url}
          expiresAt={qrInvoice.paymentAction.expiresAt}
          canSimulate={data.gateway.canSimulate}
          onSettled={() => onQrSettled(qrInvoice.id)}
        />
      )}

      <h2 className="mb-3 text-lg font-semibold">แพ็กเกจ</h2>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {data.plans.map((p) => {
          const current = data.plan?.code === p.code;
          return (
            <Card key={p.code} className={cx('flex flex-col p-5', current && 'border-emerald-600 ring-1 ring-emerald-600')}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                {current && <Badge tone="green">ปัจจุบัน</Badge>}
              </div>
              <div className="mt-3">
                <span className="text-3xl font-semibold tabular-nums">{formatMoney(p.priceMonthly)}</span>
                <span className="text-sm text-slate-500"> บาท/เดือน</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                + VAT {data.vatRate}% {formatMoney(p.vatAmount)} = {formatMoney(p.total)} บาท
              </div>
              <p className="mt-4 flex-1 text-sm text-slate-600">{p.maxUsers === null ? 'ผู้ใช้ไม่จำกัด' : `ผู้ใช้สูงสุด ${p.maxUsers} คน`}</p>
              <Button
                className="mt-5 w-full"
                variant={current ? 'primary' : 'secondary'}
                disabled={busy !== null}
                onClick={() => void checkout(p.code)}
              >
                {busy === p.code ? 'กำลังไปหน้าชำระเงิน…' : current && isPaid ? 'ต่ออายุ 1 เดือน' : current ? 'ชำระเงินแพ็กเกจนี้' : 'เปลี่ยนเป็นแพ็กเกจนี้'}
              </Button>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 text-lg font-semibold">ใบแจ้งหนี้</h2>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">เลขที่</th>
              <th className="px-4 py-2.5">วันที่ออก</th>
              <th className="px-4 py-2.5">รายการ</th>
              <th className="px-4 py-2.5">รอบบริการ</th>
              <th className="px-4 py-2.5 text-right">ก่อน VAT</th>
              <th className="px-4 py-2.5 text-right">VAT</th>
              <th className="px-4 py-2.5 text-right">รวม</th>
              <th className="px-4 py-2.5">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  ยังไม่มีใบแจ้งหนี้
                </td>
              </tr>
            )}
            {data.invoices.map((inv) => {
              const s = INVOICE_STATUS[inv.status];
              return (
                <tr key={inv.id} className={inv.status === 'void' ? 'text-slate-400' : undefined}>
                  <td className="px-4 py-2.5 font-mono">{inv.invoiceNo}</td>
                  <td className="px-4 py-2.5">{dateOf(inv.issuedAt)}</td>
                  <td className="px-4 py-2.5">{inv.description}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {inv.periodStart ? `${dateOf(inv.periodStart)} – ${dateOf(inv.periodEnd)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(inv.subtotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(inv.vatAmount)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(inv.amount)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {inv.status === 'open' && inv.paymentStatus === 'failed' && <span className="ml-2 text-xs text-red-600">ชำระไม่สำเร็จ</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
