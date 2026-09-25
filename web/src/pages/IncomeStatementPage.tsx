import { useState } from 'react';
import type { IncomeStatement, TenantDetail } from '../api';
import { useMe } from '../auth';
import { formatDate, startOfFiscalYear, startOfMonth, today } from '../format';
import { Alert, Button, Card, Field, Input, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';
import { GrandTotal, SectionRows } from './statements';

function Report({ fiscalStartMonth }: { fiscalStartMonth: number }) {
  const [from, setFrom] = useState(() => startOfFiscalYear(fiscalStartMonth));
  const [to, setTo] = useState(today);

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const qs = query.toString();
  const { data: report, error, loading } = useApi<IncomeStatement>(`/reports/income-statement${qs ? `?${qs}` : ''}`);

  const period =
    from && to ? `${formatDate(from)} – ${formatDate(to)}` : from ? `ตั้งแต่ ${formatDate(from)}` : to ? `ถึง ${formatDate(to)}` : 'ทุกช่วงเวลา';
  const presets = [
    { label: 'ปีบัญชีนี้', from: startOfFiscalYear(fiscalStartMonth), to: today() },
    { label: 'เดือนนี้', from: startOfMonth(), to: today() },
    { label: 'ทั้งหมด', from: '', to: '' },
  ];

  return (
    <>
      <PageHeader title="งบกำไรขาดทุน" subtitle={period} />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {presets.map((p) => (
          <Button
            key={p.label}
            variant={from === p.from && to === p.to ? 'secondary' : 'ghost'}
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && !report && <Loading />}
      {report && (
        <Card className="max-w-3xl overflow-hidden">
          <table className="w-full">
            <SectionRows title="รายได้" section={report.revenue} totalLabel="รวมรายได้" />
            <SectionRows title="ค่าใช้จ่าย" section={report.expenses} totalLabel="รวมค่าใช้จ่าย" />
            <GrandTotal label={report.netIncome < 0 ? 'ขาดทุนสุทธิ' : 'กำไรสุทธิ'} amount={report.netIncome} />
          </table>
        </Card>
      )}
    </>
  );
}

export default function IncomeStatementPage() {
  const me = useMe();
  // The default period is the tenant's fiscal year, so wait for the company settings.
  const { data: tenant, error } = useApi<TenantDetail>(`/tenants/${me.tenantId}`);
  if (error) return <Alert>{error}</Alert>;
  if (!tenant) return <Loading />;
  return <Report fiscalStartMonth={tenant.company?.fiscalYearStartMonth ?? 1} />;
}
