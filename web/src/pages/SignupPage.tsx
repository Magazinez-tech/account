import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Tokens } from '../api';
import { LAST_SLUG_KEY, useAuth } from '../auth';
import { Alert, Button, Field, Input } from '../ui';
import { AuthShell } from './LoginPage';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function SignupPage() {
  const { startSession } = useAuth();
  const [form, setForm] = useState({ companyName: '', slug: '', companyTaxId: '', adminFullName: '', adminEmail: '', adminPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const slugInvalid = form.slug !== '' && !SLUG_RE.test(form.slug);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<Tokens>('/tenants', {
        method: 'POST',
        auth: false,
        body: {
          name: form.companyName.trim(),
          companyName: form.companyName.trim(),
          slug: form.slug,
          companyTaxId: form.companyTaxId.trim() || undefined,
          adminFullName: form.adminFullName.trim(),
          adminEmail: form.adminEmail.trim(),
          adminPassword: form.adminPassword,
        },
      });
      localStorage.setItem(LAST_SLUG_KEY, form.slug);
      await startSession(res);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="สมัครใช้งาน"
      footer={
        <>
          มีบัญชีอยู่แล้ว?{' '}
          <Link to="/login" className="font-medium text-emerald-700 hover:underline">
            เข้าสู่ระบบ
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="ชื่อบริษัท">
          <Input value={form.companyName} onChange={set('companyName')} required minLength={2} maxLength={200} />
        </Field>
        <Field label="รหัสบริษัท" hint="ใช้ตอนเข้าสู่ระบบ: ตัวพิมพ์เล็ก ตัวเลข และขีด เช่น my-company">
          <Input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
            required
            maxLength={100}
            aria-invalid={slugInvalid}
            className={slugInvalid ? 'border-red-400' : undefined}
          />
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี (ไม่บังคับ)">
          <Input value={form.companyTaxId} onChange={set('companyTaxId')} inputMode="numeric" pattern="\d{10,13}" title="10-13 หลัก" />
        </Field>
        <hr className="border-slate-200" />
        <Field label="ชื่อผู้ดูแลระบบ">
          <Input value={form.adminFullName} onChange={set('adminFullName')} required minLength={2} autoComplete="name" />
        </Field>
        <Field label="อีเมล">
          <Input type="email" value={form.adminEmail} onChange={set('adminEmail')} required autoComplete="email" />
        </Field>
        <Field label="รหัสผ่าน" hint="อย่างน้อย 8 ตัวอักษร">
          <Input
            type="password"
            value={form.adminPassword}
            onChange={set('adminPassword')}
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" disabled={busy || slugInvalid} className="w-full">
          {busy ? 'กำลังสร้างบัญชี…' : 'สร้างบัญชี'}
        </Button>
      </form>
    </AuthShell>
  );
}
