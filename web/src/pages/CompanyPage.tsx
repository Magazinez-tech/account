import { useState, type FormEvent } from 'react';
import { api, type Company } from '../api';
import { isAdmin, useMe } from '../auth';
import { branchLabel } from '../sales';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Textarea } from '../ui';
import { useApi } from '../useApi';

type Form = Record<'name' | 'taxId' | 'branchCode' | 'address' | 'phone' | 'email' | 'website', string>;

const toForm = (c: Company): Form => ({
  name: c.name,
  taxId: c.taxId ?? '',
  branchCode: c.branchCode,
  address: c.address ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  website: c.website ?? '',
});

/** Issuer details printed at the top of every quotation and billing note. Admins edit; everyone can view. */
export default function CompanyPage() {
  const { data: company, error: loadError } = useApi<Company>('/company');
  if (loadError) return <Alert>{loadError}</Alert>;
  if (!company) return <Loading />;
  return <CompanyForm company={company} />;
}

function CompanyForm({ company }: { company: Company }) {
  const canEdit = isAdmin(useMe());
  const [form, setForm] = useState<Form>(() => toForm(company));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api<Company>('/company', {
        method: 'PATCH',
        body: { ...form, name: form.name.trim(), branchCode: form.branchCode.trim() || '00000' },
      });
      setForm(toForm(saved));
      setNotice('บันทึกข้อมูลบริษัทแล้ว');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="ข้อมูลบริษัท" subtitle="แสดงเป็นผู้ออกเอกสารบนใบเสนอราคาและใบวางบิล" />
      <form onSubmit={submit} className="max-w-3xl space-y-4">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {!canEdit && <Alert tone="success">เฉพาะผู้ดูแลระบบ (Admin) แก้ไขข้อมูลบริษัทได้</Alert>}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="ชื่อบริษัท (ตามที่จดทะเบียน)">
              <Input value={form.name} onChange={set('name')} required minLength={2} maxLength={200} disabled={!canEdit} />
            </Field>
          </div>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <Input
              value={form.taxId}
              onChange={set('taxId')}
              inputMode="numeric"
              pattern="\d{10,13}"
              maxLength={13}
              placeholder="13 หลัก"
              disabled={!canEdit}
            />
          </Field>
          <Field label="สาขา" hint={branchLabel(form.branchCode || '00000') ?? undefined}>
            <Input
              value={form.branchCode}
              onChange={set('branchCode')}
              inputMode="numeric"
              pattern="\d{5}"
              maxLength={5}
              placeholder="00000 = สำนักงานใหญ่"
              disabled={!canEdit}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="ที่อยู่">
              <Textarea value={form.address} onChange={set('address')} maxLength={1000} disabled={!canEdit} />
            </Field>
          </div>
          <Field label="โทรศัพท์">
            <Input value={form.phone} onChange={set('phone')} maxLength={50} disabled={!canEdit} />
          </Field>
          <Field label="อีเมล">
            <Input type="email" value={form.email} onChange={set('email')} maxLength={200} disabled={!canEdit} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="เว็บไซต์">
              <Input value={form.website} onChange={set('website')} maxLength={200} disabled={!canEdit} />
            </Field>
          </div>
        </Card>
        {canEdit && (
          <Button type="submit" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        )}
      </form>
    </>
  );
}
