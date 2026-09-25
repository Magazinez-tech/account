import { useState } from 'react';
import type { BalanceSheet } from '../api';
import { formatDate, today } from '../format';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';
import { AmountRow, GrandTotal, SectionRows } from './statements';

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(today);
  const { data: bs, error, loading } = useApi<BalanceSheet>(`/reports/balance-sheet${asOf ? `?asOf=${asOf}` : ''}`);

  return (
    <>
      <PageHeader
        title="งบแสดงฐานะการเงิน"
        subtitle={asOf ? `ณ วันที่ ${formatDate(asOf)}` : 'ทุกรายการที่ผ่านรายการแล้ว'}
        actions={bs && (bs.balanced ? <Badge tone="green">สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ</Badge> : <Badge tone="red">ยอดไม่ดุล</Badge>)}
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="ณ วันที่">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        {asOf !== today() && (
          <Button variant="ghost" onClick={() => setAsOf(today())}>
            วันนี้
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && !bs && <Loading />}
      {bs && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <table className="w-full">
              <SectionRows title="สินทรัพย์" section={bs.assets} totalLabel="รวมสินทรัพย์" />
              <GrandTotal label="รวมสินทรัพย์ทั้งสิ้น" amount={bs.assets.total} />
            </table>
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full">
              <SectionRows title="หนี้สิน" section={bs.liabilities} totalLabel="รวมหนี้สิน" />
              <SectionRows
                title="ส่วนของเจ้าของ"
                section={bs.equity}
                totalLabel="รวมส่วนของเจ้าของ"
                extra={
                  bs.equity.currentEarnings !== 0 && (
                    // No closing entries yet: profit to date is shown here so the statement balances.
                    <AmountRow label="กำไร (ขาดทุน) งวดปัจจุบัน" amount={bs.equity.currentEarnings} muted />
                  )
                }
              />
              <GrandTotal label="รวมหนี้สินและส่วนของเจ้าของ" amount={bs.totalLiabilitiesAndEquity} />
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
