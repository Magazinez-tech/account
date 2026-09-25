import { useState, type FormEvent } from 'react';
import { api, type Customer } from '../api';
import { branchLabel } from '../sales';
import { Alert, Badge, Button, Card, cx, Field, Input, Loading, PageHeader, Textarea } from '../ui';
import { useApi } from '../useApi';

type Form = Record<'name' | 'taxId' | 'branchCode' | 'address' | 'contactName' | 'phone' | 'email' | 'creditDays' | 'notes', string>;

const EMPTY: Form = { name: '', taxId: '', branchCode: '', address: '', contactName: '', phone: '', email: '', creditDays: '30', notes: '' };

const toForm = (c: Customer): Form => ({
  name: c.name,
  taxId: c.taxId ?? '',
  branchCode: c.branchCode ?? '',
  address: c.address ?? '',
  contactName: c.contactName ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  creditDays: String(c.creditDays),
  notes: c.notes ?? '',
});

/** Add (customer undefined) or edit a customer. Empty fields are sent as "" and stored as not set. */
function CustomerForm({ customer, onSaved, onCancel }: { customer?: Customer; onSaved(c: Customer): void; onCancel(): void }) {
  const [form, setForm] = useState<Form>(customer ? toForm(customer) : EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, name: form.name.trim(), creditDays: Number(form.creditDays || 0) };
      const saved = customer
        ? await api<Customer>(`/customers/${customer.id}`, { method: 'PATCH', body })
        : await api<Customer>('/customers', { method: 'POST', body });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold">{customer ? `แก้ไขลูกค้า: ${customer.name}` : 'เพิ่มลูกค้า'}</h2>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label="ชื่อลูกค้า / บริษัท">
              <Input value={form.name} onChange={set('name')} required maxLength={200} />
            </Field>
          </div>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <Input value={form.taxId} onChange={set('taxId')} inputMode="numeric" pattern="\d{13}" maxLength={13} placeholder="13 หลัก" />
          </Field>
          <Field label="สาขา" hint={form.branchCode ? (branchLabel(form.branchCode) ?? undefined) : 'เว้นว่างถ้าไม่ได้จด VAT'}>
            <Input value={form.branchCode} onChange={set('branchCode')} inputMode="numeric" pattern="\d{5}" maxLength={5} placeholder="00000" />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="ที่อยู่">
              <Textarea value={form.address} onChange={set('address')} rows={2} maxLength={1000} />
            </Field>
          </div>
          <Field label="ผู้ติดต่อ">
            <Input value={form.contactName} onChange={set('contactName')} maxLength={200} />
          </Field>
          <Field label="โทรศัพท์">
            <Input value={form.phone} onChange={set('phone')} maxLength={50} />
          </Field>
          <Field label="อีเมล">
            <Input type="email" value={form.email} onChange={set('email')} maxLength={200} />
          </Field>
          <Field label="เครดิต (วัน)" hint="ใช้คำนวณวันครบกำหนดของใบวางบิล">
            <Input type="number" min={0} max={365} value={form.creditDays} onChange={set('creditDays')} required />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Field label="หมายเหตุ">
              <Textarea value={form.notes} onChange={set('notes')} rows={2} maxLength={2000} />
            </Field>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            ยกเลิก
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function CustomersPage() {
  const [showInactive, setShowInactive] = useState(false);
  const { data: customers, error, loading, reload } = useApi<Customer[]>(`/customers${showInactive ? '?includeInactive=true' : ''}`);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function setActive(c: Customer, isActive: boolean) {
    setActionError(null);
    try {
      await api(`/customers/${c.id}`, { method: 'PATCH', body: { isActive } });
      setNotice(isActive ? `เปิดใช้งาน ${c.name} แล้ว` : `ปิดใช้งาน ${c.name} แล้ว`);
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        subtitle={customers ? `${customers.length} ราย` : undefined}
        actions={
          editing === null && (
            <Button
              onClick={() => {
                setEditing('new');
                setNotice(null);
              }}
            >
              + เพิ่มลูกค้า
            </Button>
          )
        }
      />
      <div className="mb-4 space-y-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        {(error || actionError) && <Alert>{error ?? actionError}</Alert>}
      </div>
      {editing !== null && (
        <CustomerForm
          key={editing === 'new' ? 'new' : editing.id}
          customer={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={(c) => {
            setNotice(editing === 'new' ? `เพิ่มลูกค้า ${c.name} แล้ว` : `บันทึก ${c.name} แล้ว`);
            setEditing(null);
            reload();
          }}
        />
      )}
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> แสดงลูกค้าที่ปิดใช้งาน
      </label>
      {loading && !customers && <Loading />}
      {customers && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">ชื่อ</th>
                <th className="px-4 py-2.5">เลขผู้เสียภาษี / สาขา</th>
                <th className="px-4 py-2.5">ผู้ติดต่อ</th>
                <th className="px-4 py-2.5 text-right">เครดิต</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    ยังไม่มีลูกค้า เพิ่มลูกค้าก่อนสร้างใบเสนอราคาหรือใบวางบิล
                  </td>
                </tr>
              )}
              {customers.map((c) => (
                <tr key={c.id} className={cx(!c.isActive && 'text-slate-400')}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{c.name}</div>
                    {c.address && <div className="max-w-md truncate text-xs text-slate-500">{c.address}</div>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {c.taxId ? <span className="font-mono">{c.taxId}</span> : '—'}
                    {c.branchCode && <div className="text-xs text-slate-500">{branchLabel(c.branchCode)}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.contactName ?? '—'}
                    {(c.phone || c.email) && <div className="text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{c.creditDays} วัน</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {!c.isActive && <Badge tone="slate">ปิดใช้งาน</Badge>}
                    <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setEditing(c)} aria-label={`แก้ไข ${c.name}`}>
                      แก้ไข
                    </Button>
                    <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void setActive(c, !c.isActive)}>
                      {c.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
