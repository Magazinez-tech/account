import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, type Account, type Company, type SalesDocType, type SalesDocument } from '../api';
import { isAdmin, useMe } from '../auth';
import { formatDate, formatMoney, today } from '../format';
import { DOC_TYPES, docStatus } from '../sales';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select } from '../ui';
import { useApi } from '../useApi';
import SalesDocumentPaper from './SalesDocumentPaper';

/** Records full payment of an issued billing note into a cash or bank account. */
function PaymentForm({ doc, onPaid, onCancel }: { doc: SalesDocument; onPaid(d: SalesDocument): void; onCancel(): void }) {
  const { data: accounts } = useApi<Account[]>('/accounts');
  const [paidDate, setPaidDate] = useState(() => (today() < doc.docDate ? doc.docDate : today()));
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assets = (accounts ?? []).filter((a) => a.type === 'asset' && a.isActive && a.code !== '1100');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onPaid(await api<SalesDocument>(`/billing-notes/${doc.id}/payment`, { method: 'POST', body: { paidDate, accountId: accountId || undefined } }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5 print:hidden">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold">บันทึกรับชำระ {formatMoney(doc.total)} บาท</h2>
        <p className="text-sm text-slate-600">ระบบจะลงบัญชี เดบิต เงินสด/ธนาคาร · เครดิต ลูกหนี้การค้า ในวันที่รับชำระ</p>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="วันที่รับชำระ">
            <Input type="date" value={paidDate} min={doc.docDate} onChange={(e) => setPaidDate(e.target.value)} required />
          </Field>
          <Field label="รับเงินเข้าบัญชี">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">ค่าเริ่มต้น (1010 เงินฝากธนาคาร)</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกรับชำระ'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            ยกเลิก
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function SalesDocumentPage({ docType }: { docType: SalesDocType }) {
  const cfg = DOC_TYPES[docType];
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const admin = isAdmin(me);
  const initialNotice = (useLocation().state as { notice?: string } | null)?.notice ?? null;
  const { data: fetched, error: loadError } = useApi<SalesDocument>(`${cfg.api}/${id}`);
  const { data: company } = useApi<Company>('/company');
  // Actions return the updated document; show it without refetching.
  const [updated, setUpdated] = useState<SalesDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);

  const doc = updated?.id === id ? updated : fetched;

  async function act(path: string, body: unknown, message: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api<SalesDocument>(`${cfg.api}/${id}${path}`, { method: 'POST', body });
      setUpdated(next);
      setNotice(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createBillingNote() {
    setBusy(true);
    setError(null);
    try {
      const bn = await api<SalesDocument>(`/quotations/${id}/billing-note`, { method: 'POST', body: {} });
      navigate(`${DOC_TYPES.billing_note.path}/${bn.id}`, { state: { notice: `สร้างใบวางบิล ${bn.docNo} จาก ${doc?.docNo} แล้ว` } });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!doc) return <Loading />;

  const s = docStatus(docType, doc.status, doc.dueDate, today());
  const profileIncomplete = company && (!company.address || !company.taxId);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${cfg.title} ${doc.docNo}`}
          subtitle={`${doc.customer.name} · ${formatMoney(doc.total)} บาท${doc.createdByName ? ` · ออกโดย ${doc.createdByName}` : ''}`}
          actions={
            <>
              <Badge tone={s.tone}>{s.label}</Badge>
              <Button variant="secondary" onClick={() => window.print()}>
                พิมพ์ / PDF
              </Button>
            </>
          }
        />
        <div className="mb-4 space-y-3">
          {notice && <Alert tone="success">{notice}</Alert>}
          {error && <Alert>{error}</Alert>}
          {profileIncomplete && (
            <Alert>
              ข้อมูลบริษัทบนเอกสารยังไม่ครบ (ที่อยู่ / เลขผู้เสียภาษี){' '}
              {admin ? (
                <Link to="/company" className="font-semibold underline">
                  กรอกข้อมูลบริษัท
                </Link>
              ) : (
                'กรุณาแจ้งผู้ดูแลระบบ'
              )}
            </Alert>
          )}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {doc.status === 'draft' && (
            <Button variant="secondary" disabled={busy} onClick={() => navigate(`${cfg.path}/${doc.id}/edit`)}>
              แก้ไข
            </Button>
          )}

          {docType === 'quotation' && doc.status === 'draft' && (
            <Button disabled={busy} onClick={() => void act('/status', { status: 'sent' }, 'บันทึกว่าส่งใบเสนอราคาให้ลูกค้าแล้ว')}>
              ส่งให้ลูกค้าแล้ว
            </Button>
          )}
          {docType === 'quotation' && doc.status === 'sent' && (
            <>
              <Button disabled={busy} onClick={() => void act('/status', { status: 'accepted' }, 'ลูกค้าตอบรับใบเสนอราคาแล้ว')}>
                ลูกค้าตอบรับ
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void act('/status', { status: 'rejected' }, 'บันทึกว่าลูกค้าปฏิเสธแล้ว')}>
                ลูกค้าปฏิเสธ
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act('/status', { status: 'draft' }, 'กลับเป็นร่างแล้ว แก้ไขได้')}>
                กลับเป็นร่าง
              </Button>
            </>
          )}
          {docType === 'quotation' && doc.status === 'accepted' && !doc.billingNote && (
            <Button disabled={busy} onClick={() => void createBillingNote()}>
              สร้างใบวางบิล
            </Button>
          )}
          {doc.billingNote && (
            <Link to={`${DOC_TYPES.billing_note.path}/${doc.billingNote.id}`} className="text-sm font-medium text-emerald-800 underline">
              ใบวางบิล {doc.billingNote.docNo}
            </Link>
          )}

          {docType === 'billing_note' && doc.status === 'draft' && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(
                  '/issue',
                  undefined,
                  'ออกใบวางบิลแล้ว บันทึกลูกหนี้ในสมุดรายวันแล้ว',
                  `ออกใบวางบิล ${doc.docNo}? ระบบจะลงบัญชีลูกหนี้ ${formatMoney(doc.total)} บาท และแก้ไขเอกสารไม่ได้อีก`,
                )
              }
            >
              ออกใบวางบิล
            </Button>
          )}
          {docType === 'billing_note' && doc.status === 'issued' && !paying && (
            <Button disabled={busy} onClick={() => setPaying(true)}>
              บันทึกรับชำระ
            </Button>
          )}
          {doc.quotation && (
            <Link to={`${DOC_TYPES.quotation.path}/${doc.quotation.id}`} className="text-sm font-medium text-emerald-800 underline">
              จากใบเสนอราคา {doc.quotation.docNo}
            </Link>
          )}

          {admin && doc.status !== 'void' && !(docType === 'billing_note' && doc.status === 'paid') && (
            <Button
              variant="danger"
              className="ml-auto"
              disabled={busy}
              onClick={() =>
                void act(
                  '/void',
                  undefined,
                  `ยกเลิก${cfg.title}แล้ว`,
                  `ยกเลิก${cfg.title} ${doc.docNo}?${doc.journalEntry ? ' รายการบัญชีที่ลงไว้จะถูกยกเลิกด้วย' : ''}`,
                )
              }
            >
              ยกเลิกเอกสาร
            </Button>
          )}
        </div>

        {paying && doc.status === 'issued' && (
          <PaymentForm
            doc={doc}
            onCancel={() => setPaying(false)}
            onPaid={(d) => {
              setPaying(false);
              setUpdated(d);
              setNotice(`บันทึกรับชำระ ${d.docNo} แล้ว`);
            }}
          />
        )}

        {docType === 'billing_note' && (doc.journalEntry || doc.paidDate) && (
          <Card className="mb-6 space-y-1 p-4 text-sm text-slate-700">
            {doc.journalEntry && (
              <div>
                ลงบัญชีลูกหนี้: JV-{doc.journalEntry.entryNo} ({formatDate(doc.docDate)}) · รายได้ {doc.revenueAccount?.code} {doc.revenueAccount?.name}
              </div>
            )}
            {doc.paidDate && (
              <div>
                รับชำระ {formatDate(doc.paidDate)} เข้า {doc.paymentAccount?.code} {doc.paymentAccount?.name}
                {doc.paymentJournalEntry && ` · JV-${doc.paymentJournalEntry.entryNo}`}
              </div>
            )}
          </Card>
        )}
      </div>

      <SalesDocumentPaper doc={doc} company={company} />
    </>
  );
}
