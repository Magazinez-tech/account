import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { SalesDocType, SalesDocumentRow } from '../api';
import { formatDate, formatMoney, today } from '../format';
import { DOC_TYPES, docStatus, statusOptions } from '../sales';
import { Alert, Badge, Button, Card, cx, Loading, PageHeader, Select } from '../ui';
import { useApi } from '../useApi';

export default function SalesDocumentListPage({ docType }: { docType: SalesDocType }) {
  const cfg = DOC_TYPES[docType];
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [status, setStatus] = useState('');
  const { data: docs, error, loading } = useApi<SalesDocumentRow[]>(`${cfg.api}${status ? `?status=${status}` : ''}`);
  const now = today();

  return (
    <>
      <PageHeader
        title={cfg.title}
        subtitle={docType === 'quotation' ? 'เสนอราคาให้ลูกค้า แล้วสร้างใบวางบิลเมื่อลูกค้าตอบรับ' : 'วางบิลเรียกเก็บเงินลูกค้า และบันทึกรับชำระ'}
        actions={<Button onClick={() => navigate(`${cfg.path}/new`)}>+ สร้าง{cfg.title}</Button>}
      />
      <div className="mb-4 space-y-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert>{error}</Alert>}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="status-filter" className="text-sm text-slate-600">
          สถานะ
        </label>
        <Select id="status-filter" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">ทั้งหมด</option>
          {statusOptions(docType).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      {loading && !docs && <Loading />}
      {docs && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">เลขที่</th>
                <th className="px-4 py-2.5">วันที่</th>
                <th className="px-4 py-2.5">ลูกค้า</th>
                <th className="px-4 py-2.5">{cfg.dueLabel}</th>
                <th className="px-4 py-2.5 text-right">ยอดรวม</th>
                <th className="px-4 py-2.5">สถานะ</th>
                <th className="px-4 py-2.5">{docType === 'quotation' ? 'ใบวางบิล' : 'จากใบเสนอราคา'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    ยังไม่มี{cfg.title}
                  </td>
                </tr>
              )}
              {docs.map((d) => {
                const s = docStatus(docType, d.status, d.dueDate, now);
                const related = docType === 'quotation' ? d.billingNote : d.quotation;
                return (
                  <tr key={d.id} className={cx('hover:bg-slate-50', d.status === 'void' && 'text-slate-400')}>
                    <td className="px-4 py-2.5 font-mono">
                      <Link to={`${cfg.path}/${d.id}`} className="font-medium text-emerald-800 hover:underline">
                        {d.docNo}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(d.docDate)}</td>
                    <td className="px-4 py-2.5">
                      {d.customerName}
                      {d.reference && <div className="text-xs text-slate-500">อ้างอิง {d.reference}</div>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{d.dueDate ? formatDate(d.dueDate) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(d.total)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {related ? (
                        <Link to={`${DOC_TYPES[docType === 'quotation' ? 'billing_note' : 'quotation'].path}/${related.id}`} className="hover:underline">
                          {related.docNo}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
