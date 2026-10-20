import { useState } from 'react';
import type { VatReport } from '../api';
import { formatDate, formatMoney, today } from '../format';
import { Alert, Button, Card, Field, Input, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';

const fmt = formatMoney;

function monthOf(iso: string) {
  return iso.slice(0, 7);
}

export default function VatReportPage() {
  const [month, setMonth] = useState(() => monthOf(today()));

  const { data: report, error, loading } = useApi<VatReport>(
    `/reports/vat?month=${month}`,
  );

  const thaiMonth = new Date(`${month}-15`).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <>
      <PageHeader
        title="รายงานภาษีมูลค่าเพิ่ม (ภ.พ.30)"
        subtitle={thaiMonth}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            พิมพ์ / PDF
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        <Field label="เดือน">
          <Input
            type="month"
            value={month}
            max={monthOf(today())}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && !report && <Loading />}

      {report && (
        <div className="space-y-6 max-w-4xl">
          {/* Summary card */}
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-3 text-slate-600">ภาษีขาย (Output VAT)</td>
                  <td className="px-4 py-3 text-right">ฐานภาษี {fmt(report.outputVat.taxableAmount)} บาท</td>
                  <td className="px-4 py-3 text-right font-medium">{fmt(report.outputVat.vatAmount)} บาท</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-3 text-slate-600">ภาษีซื้อ (Input VAT)</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-medium">{fmt(report.inputVat.vatAmount)} บาท</td>
                </tr>
                <tr className={report.netVat >= 0 ? 'bg-red-50' : 'bg-emerald-50'}>
                  <td className="px-4 py-3 font-semibold" colSpan={2}>
                    {report.netVat >= 0 ? 'ภาษีที่ต้องชำระ (ภ.พ.30)' : 'ภาษีที่ขอคืน'}
                  </td>
                  <td className={`px-4 py-3 text-right text-lg font-bold ${report.netVat >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {fmt(Math.abs(report.netVat))} บาท
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* Output VAT transactions */}
          <section>
            <h2 className="mb-3 text-base font-semibold">ภาษีขาย — รายการใบวางบิล ({report.outputVat.transactions.length} รายการ)</h2>
            {report.outputVat.transactions.length === 0 ? (
              <p className="text-sm text-slate-500">ไม่มีรายการในเดือนนี้</p>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left">วันที่</th>
                      <th className="px-4 py-2 text-left">เลขที่เอกสาร</th>
                      <th className="px-4 py-2 text-left">ชื่อผู้ซื้อ</th>
                      <th className="px-4 py-2 text-right">ฐานภาษี</th>
                      <th className="px-4 py-2 text-right">ภาษีขาย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.outputVat.transactions.map((t) => (
                      <tr key={t.docNo} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 tabular-nums">{formatDate(t.docDate)}</td>
                        <td className="px-4 py-2 font-mono">{t.docNo}</td>
                        <td className="px-4 py-2">
                          {t.customerName}
                          {t.customerTaxId && <span className="ml-1 text-xs text-slate-400">{t.customerTaxId}</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(t.taxableAmount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(t.vatAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 font-semibold bg-slate-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-2 text-right">รวม</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(report.outputVat.taxableAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(report.outputVat.vatAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Card>
            )}
          </section>

          {/* Input VAT transactions */}
          <section>
            <h2 className="mb-3 text-base font-semibold">ภาษีซื้อ — รายการบัญชี 1300 ({report.inputVat.transactions.length} รายการ)</h2>
            {report.inputVat.transactions.length === 0 ? (
              <p className="text-sm text-slate-500">ไม่มีรายการในเดือนนี้</p>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left">วันที่</th>
                      <th className="px-4 py-2 text-left">เลขที่</th>
                      <th className="px-4 py-2 text-left">รายละเอียด</th>
                      <th className="px-4 py-2 text-right">ภาษีซื้อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.inputVat.transactions.map((t) => (
                      <tr key={t.entryNo} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 tabular-nums">{formatDate(t.entryDate)}</td>
                        <td className="px-4 py-2 tabular-nums">{t.entryNo}</td>
                        <td className="px-4 py-2 text-slate-600">{t.description ?? t.reference ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(t.vatAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 font-semibold bg-slate-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-2 text-right">รวม</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(report.inputVat.vatAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Card>
            )}
          </section>
        </div>
      )}
    </>
  );
}
