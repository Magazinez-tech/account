import type { Company, SalesDocument } from '../api';
import { formatDate, formatMoney } from '../format';
import { bahtText, branchLabel, DOC_TYPES } from '../sales';
import { cx } from '../ui';

const TAX_INVOICE_CFG = {
  title: 'ใบกำกับภาษี / ใบเสร็จรับเงิน',
  titleEn: 'TAX INVOICE / RECEIPT',
  issuerLabel: 'ผู้รับมอบอำนาจ',
  receiverLabel: 'ผู้รับเงิน',
};

const money = (n: number) => formatMoney(n);
const quantity = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

function Party({ label, name, lines }: { label: string; name: string; lines: (string | null | false)[] }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="font-semibold">{name}</div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} className="whitespace-pre-line text-slate-700">
          {l}
        </div>
      ))}
    </div>
  );
}

function Signature({ label, name }: { label: string; name?: string | null }) {
  return (
    <div className="text-center">
      <div className="h-12" />
      <div className="mx-auto w-52 border-b border-dotted border-slate-400" />
      <div className="mt-1 min-h-5">{name ? `(${name})` : '(.......................................)'}</div>
      <div className="font-medium">{label}</div>
      <div className="mt-1 text-slate-500">วันที่ ........../........../..........</div>
    </div>
  );
}

/**
 * The document as printed: issuer from the company profile, customer as copied onto the document,
 * lines, totals with the amount in Thai words, and signature boxes. The issuer signature shows the
 * user who created the document.
 *
 * Pass `taxInvoice` to render a paid billing note as ใบกำกับภาษี / ใบเสร็จรับเงิน, using the
 * payment date as the primary date and the billing note date as a reference row.
 */
export default function SalesDocumentPaper({ doc, company, taxInvoice = false }: { doc: SalesDocument; company: Company | null; taxInvoice?: boolean }) {
  const cfg = taxInvoice ? TAX_INVOICE_CFG : DOC_TYPES[doc.docType];
  const taxLine = (taxId: string | null, branch: string | null) =>
    taxId ? `เลขประจำตัวผู้เสียภาษี ${taxId}${branch ? ` (${branchLabel(branch)})` : ''}` : null;
  const contacts = company ? [company.phone && `โทร ${company.phone}`, company.email, company.website].filter(Boolean).join(' · ') : '';

  return (
    <article
      aria-label={`${cfg.title} ${doc.docNo}`}
      className="relative mx-auto max-w-[210mm] bg-white p-8 text-sm leading-relaxed text-slate-900 shadow-xs ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0"
    >
      {!taxInvoice && (doc.status === 'void' || doc.status === 'draft') && (
        <div
          aria-hidden
          className={cx(
            'pointer-events-none absolute inset-0 flex items-center justify-center text-8xl font-bold tracking-widest',
            doc.status === 'void' ? 'text-red-600/15' : 'text-slate-400/15',
          )}
        >
          <span className="-rotate-12">{doc.status === 'void' ? 'ยกเลิก' : 'ร่าง'}</span>
        </div>
      )}

      <header className="flex flex-wrap justify-between gap-6 border-b border-slate-300 pb-4">
        <div className="min-w-0 max-w-[60%]">
          <div className="text-lg font-bold">{company?.name ?? '—'}</div>
          {company?.address && <div className="whitespace-pre-line text-slate-700">{company.address}</div>}
          {company && taxLine(company.taxId, company.branchCode) && <div className="text-slate-700">{taxLine(company.taxId, company.branchCode)}</div>}
          {contacts && <div className="text-slate-700">{contacts}</div>}
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold text-emerald-800">{cfg.title}</h2>
          <div className="text-xs font-semibold tracking-widest text-slate-500">{cfg.titleEn}</div>
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-left">
            <dt className="text-slate-500">เลขที่</dt>
            <dd className="font-mono font-semibold">{doc.docNo}</dd>
            {taxInvoice ? (
              <>
                <dt className="text-slate-500">วันที่รับชำระ</dt>
                <dd>{formatDate(doc.paidDate!)}</dd>
                <dt className="text-slate-500">วันที่วางบิล</dt>
                <dd>{formatDate(doc.docDate)}</dd>
              </>
            ) : (
              <>
                <dt className="text-slate-500">วันที่</dt>
                <dd>{formatDate(doc.docDate)}</dd>
                {doc.dueDate && (
                  <>
                    <dt className="text-slate-500">{(cfg as (typeof DOC_TYPES)[keyof typeof DOC_TYPES]).dueLabel}</dt>
                    <dd>{formatDate(doc.dueDate)}</dd>
                  </>
                )}
              </>
            )}
            {doc.reference && (
              <>
                <dt className="text-slate-500">อ้างอิง</dt>
                <dd>{doc.reference}</dd>
              </>
            )}
            {doc.quotation && (
              <>
                <dt className="text-slate-500">ใบเสนอราคา</dt>
                <dd className="font-mono">{doc.quotation.docNo}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="grid gap-4 border-b border-slate-300 py-4 sm:grid-cols-2 print:grid-cols-2">
        <Party
          label="ลูกค้า"
          name={doc.customer.name}
          lines={[doc.customer.address, taxLine(doc.customer.taxId, doc.customer.branchCode), doc.customer.contactName && `ผู้ติดต่อ ${doc.customer.contactName}`]}
        />
      </section>

      <table className="mt-4 w-full">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-xs font-semibold text-slate-600 print:bg-transparent">
            <th className="w-10 py-2 text-center">ลำดับ</th>
            <th className="py-2 text-left">รายละเอียด</th>
            <th className="w-20 py-2 text-right">จำนวน</th>
            <th className="w-16 py-2 pl-2 text-left">หน่วย</th>
            <th className="w-28 py-2 text-right">ราคาต่อหน่วย</th>
            <th className="w-32 py-2 text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.lineNo} className="border-b border-slate-100 align-top">
              <td className="py-1.5 text-center text-slate-500">{l.lineNo}</td>
              <td className="py-1.5 whitespace-pre-line">{l.description}</td>
              <td className="py-1.5 text-right tabular-nums">{quantity.format(l.quantity)}</td>
              <td className="py-1.5 pl-2">{l.unit}</td>
              <td className="py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
              <td className="py-1.5 text-right tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 grid gap-4 sm:grid-cols-[1fr_18rem] print:grid-cols-[1fr_18rem]">
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-center font-semibold print:bg-transparent print:ring-1 print:ring-slate-300">
            ({bahtText(Math.round(doc.total * 100))})
          </div>
          {doc.notes && (
            <div>
              <div className="text-xs font-semibold text-slate-500">หมายเหตุ</div>
              <div className="whitespace-pre-line">{doc.notes}</div>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
          <dt>รวมเป็นเงิน</dt>
          <dd className="text-right">{money(doc.subtotal)}</dd>
          {doc.discount > 0 && (
            <>
              <dt>ส่วนลด</dt>
              <dd className="text-right">{money(doc.discount)}</dd>
              <dt>ยอดหลังหักส่วนลด</dt>
              <dd className="text-right">{money(doc.subtotal - doc.discount)}</dd>
            </>
          )}
          <dt>ภาษีมูลค่าเพิ่ม {doc.vatRate}%</dt>
          <dd className="text-right">{money(doc.vatAmount)}</dd>
          <dt className="border-t border-slate-300 pt-1 font-semibold">จำนวนเงินรวมทั้งสิ้น</dt>
          <dd className="border-t border-slate-300 pt-1 text-right font-semibold" data-testid="paper-total">
            {money(doc.total)}
          </dd>
        </dl>
      </section>

      <footer className="mt-12 grid grid-cols-2 gap-8 break-inside-avoid">
        <Signature label={cfg.receiverLabel} />
        <Signature label={cfg.issuerLabel} name={doc.createdByName} />
      </footer>
    </article>
  );
}
