import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Account, type Customer, type SalesDocType, type SalesDocument } from '../api';
import { addDays, formatMoney, fromSatang, parseSatang, today } from '../format';
import { DOC_TYPES, documentTotals, lineAmount, parseQuantity, VAT_RATE } from '../sales';
import { Alert, Button, Card, cx, Field, Input, Loading, PageHeader, Select, Textarea } from '../ui';
import { useApi } from '../useApi';

interface LineDraft {
  key: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

let nextKey = 1;
const blankLine = (): LineDraft => ({ key: nextKey++, description: '', quantity: '1', unit: '', unitPrice: '' });
const isBlank = (l: LineDraft) => !l.description.trim() && !l.unitPrice.trim();

/** Quotation validity when the user hasn't picked a date. */
const QUOTATION_VALID_DAYS = 30;

function checkLine(l: LineDraft): { amount: number; problem: string | null } {
  const qty = parseQuantity(l.quantity);
  const price = parseSatang(l.unitPrice);
  if (!l.description.trim()) return { amount: 0, problem: 'ใส่รายละเอียด' };
  if (qty === null || qty === 0) return { amount: 0, problem: 'จำนวนต้องมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)' };
  if (price === null) return { amount: 0, problem: 'ราคาไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)' };
  return { amount: lineAmount(qty, price), problem: null };
}

/** New document, or edit a draft when the route has :id. */
export default function SalesDocumentFormPage({ docType }: { docType: SalesDocType }) {
  const { id } = useParams();
  const { data: customers, error: customersError } = useApi<Customer[]>('/customers');
  const { data: accounts } = useApi<Account[]>('/accounts');
  const { data: existing, error: loadError } = useApi<SalesDocument>(id ? `${DOC_TYPES[docType].api}/${id}` : null);

  if (loadError || customersError) return <Alert>{loadError ?? customersError}</Alert>;
  if (!customers || (id && !existing)) return <Loading />;
  if (existing && existing.status !== 'draft') return <Alert>แก้ไขได้เฉพาะเอกสารสถานะร่าง</Alert>;
  return <DocumentForm docType={docType} existing={existing ?? undefined} customers={customers} accounts={accounts ?? []} />;
}

function DocumentForm({
  docType,
  existing,
  customers,
  accounts,
}: {
  docType: SalesDocType;
  existing?: SalesDocument;
  customers: Customer[];
  accounts: Account[];
}) {
  const cfg = DOC_TYPES[docType];
  const navigate = useNavigate();
  const id = existing?.id;
  const [customerId, setCustomerId] = useState(existing?.customerId ?? '');
  const [docDate, setDocDate] = useState(existing?.docDate ?? today());
  // null until the user picks a date; until then the due date follows the document date and customer.
  const [dueOverride, setDueOverride] = useState<string | null>(existing ? (existing.dueDate ?? '') : null);
  const [reference, setReference] = useState(existing?.reference ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [vat, setVat] = useState(existing ? existing.vatRate > 0 : true);
  const [discount, setDiscount] = useState(existing?.discount ? String(existing.discount) : '');
  const [revenueAccountId, setRevenueAccountId] = useState(existing?.revenueAccount?.id ?? '');
  const [lines, setLines] = useState<LineDraft[]>(() =>
    existing
      ? existing.lines.map((l) => ({
          key: nextKey++,
          description: l.description,
          quantity: String(l.quantity),
          unit: l.unit ?? '',
          unitPrice: String(l.unitPrice),
        }))
      : [blankLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Default due date: billing note = date + the customer's credit days; quotation = date + 30 days.
  const customer = customers.find((c) => c.id === customerId);
  const defaultDue = !docDate
    ? ''
    : docType === 'quotation'
      ? addDays(docDate, QUOTATION_VALID_DAYS)
      : customer
        ? addDays(docDate, customer.creditDays)
        : '';
  const dueDate = dueOverride ?? defaultDue;

  const update = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const filled = lines.filter((l) => !isBlank(l));
  const checked = new Map(filled.map((l) => [l.key, checkLine(l)]));
  const discountSatang = parseSatang(discount);
  const totals = documentTotals(
    [...checked.values()].map((c) => c.amount),
    discountSatang ?? 0,
    vat ? VAT_RATE : 0,
  );
  const discountProblem = discountSatang === null ? 'ส่วนลดไม่ถูกต้อง' : discountSatang > totals.subtotal ? 'ส่วนลดมากกว่ายอดรวม' : null;
  const dueProblem = dueDate && dueDate < docDate ? `${cfg.dueLabel}ต้องไม่ก่อนวันที่เอกสาร` : null;
  const canSubmit =
    !!customerId && filled.length > 0 && [...checked.values()].every((c) => !c.problem) && !discountProblem && !dueProblem && !!docDate;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        customerId,
        docDate,
        dueDate: dueDate || undefined,
        reference: reference.trim(),
        notes: notes.trim(),
        vat,
        discount: fromSatang(discountSatang ?? 0),
        ...(docType === 'billing_note' && { revenueAccountId: revenueAccountId || undefined }),
        lines: filled.map((l) => ({
          description: l.description.trim(),
          quantity: (parseQuantity(l.quantity) ?? 0) / 100,
          unit: l.unit.trim(),
          unitPrice: fromSatang(parseSatang(l.unitPrice) ?? 0),
        })),
      };
      const saved = await api<SalesDocument>(id ? `${cfg.api}/${id}` : cfg.api, { method: id ? 'PUT' : 'POST', body });
      navigate(`${cfg.path}/${saved.id}`, { state: { notice: id ? `บันทึก ${saved.docNo} แล้ว` : `สร้าง${cfg.title} ${saved.docNo} แล้ว` } });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const revenueAccounts = accounts.filter((a) => a.type === 'revenue' && a.isActive);
  const editingCustomerGone = !!customerId && !customer;

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={existing ? `แก้ไข${cfg.title} ${existing.docNo}` : `สร้าง${cfg.title}`}
        subtitle="ราคาต่อหน่วยไม่รวม VAT · ส่วนลดหักก่อนคำนวณ VAT"
      />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {customers.length === 0 && (
        <div className="mb-4">
          <Alert>
            ยังไม่มีลูกค้า{' '}
            <Link to="/customers" className="font-semibold underline">
              เพิ่มลูกค้าก่อน
            </Link>
          </Alert>
        </div>
      )}

      <Card className="mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="ลูกค้า">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">เลือกลูกค้า…</option>
              {editingCustomerGone && <option value={customerId}>(ลูกค้าที่ปิดใช้งาน)</option>}
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {customer && (
            <p className="mt-1 text-xs text-slate-500">
              {[customer.taxId && `เลขผู้เสียภาษี ${customer.taxId}`, `เครดิต ${customer.creditDays} วัน`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <Field label="วันที่เอกสาร">
          <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} required />
        </Field>
        <Field label={cfg.dueLabel}>
          <Input
            type="date"
            value={dueDate}
            min={docDate || undefined}
            onChange={(e) => setDueOverride(e.target.value)}
            aria-invalid={!!dueProblem}
          />
          {dueProblem && <span className="mt-1 block text-xs text-red-600">{dueProblem}</span>}
        </Field>
        <div className="sm:col-span-2">
          <Field label="เลขที่อ้างอิง" hint="เช่น เลขที่ใบสั่งซื้อ (PO) ของลูกค้า">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </Field>
        </div>
        {docType === 'billing_note' && (
          <div className="sm:col-span-2">
            <Field label="บัญชีรายได้" hint="ลงบัญชีเมื่อออกใบวางบิล">
              <Select value={revenueAccountId} onChange={(e) => setRevenueAccountId(e.target.value)}>
                <option value="">ค่าเริ่มต้น (4000 รายได้จากการขาย)</option>
                {revenueAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">รายละเอียด</th>
              <th className="w-28 px-3 py-2.5 text-right">จำนวน</th>
              <th className="w-28 px-3 py-2.5">หน่วย</th>
              <th className="w-40 px-3 py-2.5 text-right">ราคาต่อหน่วย</th>
              <th className="w-36 px-3 py-2.5 text-right">จำนวนเงิน</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const c = checked.get(l.key);
              return (
                <tr key={l.key} className="align-top">
                  <td className="px-3 py-2.5 pt-4 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} aria-label={`รายละเอียด บรรทัด ${i + 1}`} />
                    {c?.problem && <p className="mt-1 text-xs text-red-600">{c.problem}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.quantity}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-label={`จำนวน บรรทัด ${i + 1}`}
                      onChange={(e) => update(l.key, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} maxLength={30} aria-label={`หน่วย บรรทัด ${i + 1}`} />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.unitPrice}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-label={`ราคาต่อหน่วย บรรทัด ${i + 1}`}
                      onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2.5 pt-4 text-right tabular-nums">{c && !c.problem ? formatMoney(fromSatang(c.amount)) : '—'}</td>
                  <td className="px-1 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2"
                      aria-label={`ลบบรรทัด ${i + 1}`}
                      disabled={lines.length <= 1}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-slate-200 px-3 py-3">
          <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            + เพิ่มรายการ
          </Button>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Field label="หมายเหตุ / เงื่อนไข" hint="พิมพ์บนเอกสาร">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000} />
        </Field>
        <Card className="space-y-2 p-4 text-sm">
          <div className="flex justify-between">
            <span>รวมเป็นเงิน</span>
            <span className="tabular-nums">{formatMoney(fromSatang(totals.subtotal))}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="discount">ส่วนลด</label>
            <Input
              id="discount"
              value={discount}
              inputMode="decimal"
              placeholder="0.00"
              className={cx('w-36 text-right tabular-nums', discountProblem && 'border-red-400')}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          {discountProblem && <p className="text-right text-xs text-red-600">{discountProblem}</p>}
          <div className="flex justify-between">
            <span>ยอดหลังหักส่วนลด</span>
            <span className="tabular-nums">{formatMoney(fromSatang(totals.net))}</span>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} /> ภาษีมูลค่าเพิ่ม {VAT_RATE}%
            </label>
            <span className="tabular-nums">{formatMoney(fromSatang(totals.vat))}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <span>จำนวนเงินรวมทั้งสิ้น</span>
            <span className="tabular-nums" data-testid="doc-total">
              {formatMoney(fromSatang(totals.total))}
            </span>
          </div>
        </Card>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => navigate(id ? `${cfg.path}/${id}` : cfg.path)}>
          ยกเลิก
        </Button>
        <Button type="submit" disabled={!canSubmit || busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
        </Button>
      </div>
    </form>
  );
}
