import { useState } from 'react';
import { api, type FiscalYearStatus } from '../api';
import { formatAmount, formatDate } from '../format';
import { Alert, Badge, Button, Card, cx, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const period = (start: string, end: string) => `${formatDate(start)} – ${formatDate(end)}`;

function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx('mt-0.5 tabular-nums', strong ? 'text-xl font-semibold' : 'text-lg', value < 0 && 'text-red-700')}>{formatAmount(value)}</div>
    </div>
  );
}

export default function ClosingPage() {
  const { data, error, loading, reload } = useApi<FiscalYearStatus>('/fiscal-years');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await api(path, { method: 'POST', body });
      setNotice(done);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const next = data.nextClosable;
  const latest = data.closings[0];

  return (
    <>
      <PageHeader
        title="ปิดบัญชีสิ้นปี"
        subtitle={`ปีบัญชีเริ่มเดือน${MONTHS[data.fiscalYearStartMonth - 1]} · ${
          data.closedThrough ? `ปิดบัญชีถึง ${formatDate(data.closedThrough)}` : 'ยังไม่เคยปิดบัญชี'
        }`}
      />
      <div className="mb-6 space-y-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        {actionError && <Alert>{actionError}</Alert>}
      </div>

      {next ? (
        <Card className="mb-8 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">ปีบัญชี {period(next.fiscalYearStart, next.fiscalYearEnd)}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                ระบบจะบันทึกรายการปิดบัญชีลงวันที่ {formatDate(next.fiscalYearEnd)} โอนยอดบัญชีรายได้และค่าใช้จ่ายทั้งหมดไปที่{' '}
                {next.retainedEarningsAccount ? `${next.retainedEarningsAccount.code} ${next.retainedEarningsAccount.name}` : 'บัญชีกำไรสะสม'}{' '}
                แล้วล็อกปีนี้ไม่ให้บันทึกหรือยกเลิกรายการเพิ่ม
              </p>
            </div>
            {next.canClose ? <Badge tone="amber">พร้อมปิดบัญชี</Badge> : <Badge tone="slate">ยังไม่สิ้นปีบัญชี</Badge>}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Amount label="รายได้" value={next.revenue} />
            <Amount label="ค่าใช้จ่าย" value={next.expenses} />
            <Amount label={next.netIncome < 0 ? 'ขาดทุนสุทธิ' : 'กำไรสุทธิ'} value={next.netIncome} strong />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              disabled={!next.canClose || busy || !next.retainedEarningsAccount}
              onClick={() => {
                if (!confirm(`ปิดบัญชีปีบัญชี ${period(next.fiscalYearStart, next.fiscalYearEnd)}? หลังปิดแล้วจะบันทึกหรือยกเลิกรายการในปีนี้ไม่ได้ จนกว่าจะเปิดปีบัญชีอีกครั้ง`)) return;
                void act('/fiscal-years/close', { fiscalYearEnd: next.fiscalYearEnd }, `ปิดบัญชีปีบัญชี ${period(next.fiscalYearStart, next.fiscalYearEnd)} แล้ว`);
              }}
            >
              {busy ? 'กำลังปิดบัญชี…' : 'ปิดบัญชีปีนี้'}
            </Button>
            {!next.canClose && <span className="text-sm text-slate-500">ปิดบัญชีได้หลังวันที่ {formatDate(next.fiscalYearEnd)}</span>}
          </div>
        </Card>
      ) : (
        <Card className="mb-8 p-8 text-center text-sm text-slate-500">ยังไม่มีรายการบัญชีให้ปิด</Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">ปีบัญชีที่ปิดแล้ว</h2>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">ปีบัญชี</th>
              <th className="px-4 py-2.5 text-right">กำไร (ขาดทุน)</th>
              <th className="px-4 py-2.5">รายการปิดบัญชี</th>
              <th className="px-4 py-2.5">ปิดเมื่อ</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.closings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  ยังไม่มี
                </td>
              </tr>
            )}
            {data.closings.map((c) => (
              <tr key={c.fiscalYearEnd}>
                <td className="px-4 py-2.5">{period(c.fiscalYearStart, c.fiscalYearEnd)}</td>
                <td className={cx('px-4 py-2.5 text-right tabular-nums', c.netIncome < 0 && 'text-red-700')}>{formatAmount(c.netIncome)}</td>
                <td className="px-4 py-2.5 font-mono">{c.entryNo ? `JV-${c.entryNo}` : '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">
                  {formatDate(c.closedAt.slice(0, 10))}
                  {c.closedBy && ` · ${c.closedBy}`}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {c === latest && (
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`เปิดปีบัญชี ${period(c.fiscalYearStart, c.fiscalYearEnd)} อีกครั้ง? รายการปิดบัญชีจะถูกยกเลิก และแก้ไขรายการในปีนี้ได้อีก`)) return;
                        void act(`/fiscal-years/${c.fiscalYearEnd}/reopen`, undefined, `เปิดปีบัญชี ${period(c.fiscalYearStart, c.fiscalYearEnd)} อีกครั้งแล้ว`);
                      }}
                    >
                      เปิดปีบัญชีอีกครั้ง
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
