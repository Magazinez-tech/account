import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LAST_SLUG_KEY, useAuth } from '../auth';
import { Alert, Button, Card, Field, Input } from '../ui';

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold uppercase tracking-wider text-emerald-700">Accounting SaaS</div>
          <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        </div>
        <Card className="p-6">{children}</Card>
        <p className="mt-4 text-center text-sm text-slate-600">{footer}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [slug, setSlug] = useState(() => localStorage.getItem(LAST_SLUG_KEY) ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(slug.trim(), email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="เข้าสู่ระบบ"
      footer={
        <>
          ยังไม่มีบัญชี?{' '}
          <Link to="/signup" className="font-medium text-emerald-700 hover:underline">
            สมัครใช้งานฟรี 14 วัน
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="รหัสบริษัท" hint="เช่น my-company (ตั้งไว้ตอนสมัคร)">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} required autoComplete="organization" />
        </Field>
        <Field label="อีเมล">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="รหัสผ่าน">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </Button>
      </form>
    </AuthShell>
  );
}
