import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type InvitePreview, type Tokens } from '../api';
import { LAST_SLUG_KEY, useAuth } from '../auth';
import { Alert, Button, Field, Input, Loading } from '../ui';
import { useApi } from '../useApi';
import { AuthShell } from './LoginPage';

export default function AcceptInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { startSession } = useAuth();
  const { data: invite, error: loadError } = useApi<InvitePreview>(`/invites/${encodeURIComponent(token)}`, { auth: false });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmPassword !== '' && password !== confirmPassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<Tokens & { tenantSlug: string }>(`/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        auth: false,
        body: { password },
      });
      localStorage.setItem(LAST_SLUG_KEY, res.tenantSlug);
      await startSession(res);
      navigate('/journal', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const footer = (
    <Link to="/login" className="font-medium text-emerald-700 hover:underline">
      ไปหน้าเข้าสู่ระบบ
    </Link>
  );

  if (loadError) {
    return (
      <AuthShell title="เข้าร่วมบริษัท" footer={footer}>
        <Alert>{loadError}</Alert>
        <p className="mt-3 text-sm text-slate-600">ขอลิงก์ใหม่จากผู้ดูแลระบบของบริษัท</p>
      </AuthShell>
    );
  }
  if (!invite) return <Loading />;

  return (
    <AuthShell title={`เข้าร่วม ${invite.companyName}`} footer={footer}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          สวัสดี {invite.fullName} ตั้งรหัสผ่านเพื่อเริ่มใช้งาน
        </p>
        {error && <Alert>{error}</Alert>}
        <Field label="รหัสบริษัท" hint="ใช้ตอนเข้าสู่ระบบครั้งต่อไป">
          <Input value={invite.tenantSlug} readOnly disabled />
        </Field>
        <Field label="อีเมล">
          <Input value={invite.email} readOnly disabled autoComplete="username" />
        </Field>
        <Field label="รหัสผ่าน" hint="อย่างน้อย 8 ตัวอักษร">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
          />
        </Field>
        <Field label="ยืนยันรหัสผ่าน">
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            aria-invalid={mismatch}
            className={mismatch ? 'border-red-400' : undefined}
            autoComplete="new-password"
          />
        </Field>
        {mismatch && <p className="text-xs text-red-600">รหัสผ่านไม่ตรงกัน</p>}
        <Button type="submit" disabled={busy || mismatch} className="w-full">
          {busy ? 'กำลังสร้างบัญชี…' : 'เริ่มใช้งาน'}
        </Button>
      </form>
    </AuthShell>
  );
}
