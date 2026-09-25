import { useState } from 'react';
import type { TrialBalance } from '../api';
import { ACCOUNT_TYPE_LABELS, formatDate, formatMoney } from '../format';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';

export default function TrialBalancePage() {
  const [asOf, setAsOf] = useState('');
  const { data: tb, error, loading } = useApi<TrialBalance>(`/reports/trial-balance${asOf ? `?asOf=${asOf}` : ''}`);

  return (
    <>
      <PageHeader
        title="งบทดลอง"
        subtitle={tb?.asOf ? `ณ วันที่ ${formatDate(tb.asOf)}` : 'ทุกรายการที่ผ่านรายการแล้ว'}
        actions={
          tb && (tb.balanced ? <Badge tone="green">ยอดดุล</Badge> : <Badge tone="red">ยอดไม่ดุล</Badge>)
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="ณ วันที่">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        {asOf && (
          <Button variant="ghost" onClick={() => setAsOf('')}>
            ทั้งหมด
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && !tb && <Loading />}
      {tb && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-24 px-4 py-2.5">รหัส</th>
                <th className="px-4 py-2.5">ชื่อบัญชี</th>
                <th className="px-4 py-2.5">หมวด</th>
                <th className="w-40 px-4 py-2.5 text-right">เดบิต</th>
                <th className="w-40 px-4 py-2.5 text-right">เครดิต</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tb.accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    ยังไม่มียอดคงเหลือ
                  </td>
                </tr>
              )}
              {tb.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{a.code}</td>
                  <td className="px-4 py-2.5">{a.name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{ACCOUNT_TYPE_LABELS[a.type]}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.debit ? formatMoney(a.debit) : ''}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.credit ? formatMoney(a.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 font-semibold">
              <tr>
                <td colSpan={3} className="px-4 py-3">
                  รวม
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(tb.totalDebit)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(tb.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </>
  );
}
