import { Link } from 'react-router-dom';
import type { DashboardSummary } from '../api';
import { formatMoney } from '../format';
import { Alert, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';

function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  const valueClass = {
    neutral: 'text-slate-800',
    positive: 'text-emerald-700',
    negative: 'text-red-700',
    warning: 'text-amber-700',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading } = useApi<DashboardSummary>('/reports/dashboard');

  if (error) return <Alert>{error}</Alert>;
  if (loading && !data) return <Loading />;

  const d = data!;
  const incomeTone = d.thisMonthNetIncome > 0 ? 'positive' : d.thisMonthNetIncome < 0 ? 'negative' : 'neutral';

  return (
    <>
      <PageHeader title="ภาพรวม" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="เงินสด + เงินฝากธนาคาร"
          value={`${formatMoney(d.cashBalance)} ฿`}
          sub="บัญชี 1000, 1010, 1020"
          tone={d.cashBalance >= 0 ? 'neutral' : 'negative'}
        />
        <KpiCard
          label="ลูกหนี้การค้าคงค้าง"
          value={`${formatMoney(d.arBalance)} ฿`}
          sub="บัญชี 1100"
        />
        <KpiCard
          label="กำไรสุทธิเดือนนี้"
          value={`${formatMoney(Math.abs(d.thisMonthNetIncome))} ฿`}
          sub={d.thisMonthNetIncome < 0 ? 'ขาดทุน' : 'กำไร'}
          tone={incomeTone}
        />
        <KpiCard
          label="ใบวางบิลเกินกำหนด"
          value={String(d.overdueCount)}
          sub={d.overdueCount > 0 ? 'รายการ' : 'ไม่มีรายการค้างชำระ'}
          tone={d.overdueCount > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <QuickLink to="/billing-notes" label="ใบวางบิล" desc="ออกใบวางบิล · บันทึกรับชำระ" />
        <QuickLink to="/quotations" label="ใบเสนอราคา" desc="สร้างใบเสนอราคาใหม่" />
        <QuickLink to="/journal/new" label="บันทึกรายการ" desc="บันทึกรายวันทั่วไป" />
        <QuickLink to="/income-statement" label="งบกำไรขาดทุน" desc="รายได้ · ค่าใช้จ่าย · กำไรสุทธิ" />
        <QuickLink to="/balance-sheet" label="งบฐานะการเงิน" desc="สินทรัพย์ · หนี้สิน · ทุน" />
        <QuickLink to="/vat-report" label="รายงาน VAT (ภ.พ.30)" desc="ภาษีขาย · ภาษีซื้อ · ยอดชำระ" />
      </div>
    </>
  );
}

function QuickLink({ to, label, desc }: { to: string; label: string; desc: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-emerald-300 hover:bg-emerald-50"
    >
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className="text-xs text-slate-500">{desc}</span>
    </Link>
  );
}
