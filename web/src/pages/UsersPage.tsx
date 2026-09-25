import { useState, type FormEvent } from 'react';
import { api, type Invitation, type RoleName, type UserRow } from '../api';
import { useAuth, useMe } from '../auth';
import { formatDate } from '../format';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select } from '../ui';
import { useApi } from '../useApi';

const ROLE_LABELS: Record<RoleName, string> = { Admin: 'ผู้ดูแลระบบ', User: 'ผู้ใช้งาน' };
const ROLE_HINT = 'ผู้ใช้งาน: ดูข้อมูลและบันทึกรายการได้ · ผู้ดูแลระบบ: ทำได้ทุกอย่าง รวมถึงแก้ผังบัญชี ยกเลิกรายการ และจัดการผู้ใช้';

const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;
const dateOf = (iso: string) => formatDate(iso.slice(0, 10));

function RoleSelect({ value, onChange, disabled }: { value: RoleName; onChange(r: RoleName): void; disabled?: boolean }) {
  return (
    <div className="w-36">
      <Select value={value} onChange={(e) => onChange(e.target.value as RoleName)} disabled={disabled} className="py-1.5">
        {(Object.keys(ROLE_LABELS) as RoleName[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Shows a freshly created invite link once; the server never returns the token again. */
function InviteLinkBox({ email, token, onClose }: { email: string; token: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(token);
  return (
    <Card className="mb-6 border-emerald-200 bg-emerald-50/50 p-5">
      <h2 className="font-semibold">ส่งลิงก์นี้ให้ {email}</h2>
      <p className="mt-1 text-sm text-slate-600">
        ลิงก์ใช้ได้ครั้งเดียวและหมดอายุใน 7 วัน ระบบจะไม่แสดงลิงก์นี้อีก ถ้าทำหายให้กด "สร้างลิงก์ใหม่"
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label="ลิงก์คำเชิญ" />
        <Button
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? '✓ คัดลอกแล้ว' : 'คัดลอกลิงก์'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          ปิด
        </Button>
      </div>
    </Card>
  );
}

function InviteForm({ onInvited, onCancel }: { onInvited(email: string, token: string): void; onCancel(): void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<RoleName>('User');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email: string; token: string }>('/invitations', {
        method: 'POST',
        body: { email: email.trim(), fullName: fullName.trim(), role },
      });
      onInvited(res.email, res.token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold">เชิญผู้ใช้</h2>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="อีเมล">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="ชื่อ-นามสกุล">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={200} />
          </Field>
          <Field label="สิทธิ์">
            <Select value={role} onChange={(e) => setRole(e.target.value as RoleName)}>
              {(Object.keys(ROLE_LABELS) as RoleName[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">{ROLE_HINT}</p>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'กำลังสร้าง…' : 'สร้างลิงก์คำเชิญ'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            ยกเลิก
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function UsersPage() {
  const me = useMe();
  const { reloadMe } = useAuth();
  const users = useApi<UserRow[]>('/users');
  const invitations = useApi<Invitation[]>('/invitations');
  const [inviting, setInviting] = useState(false);
  const [newLink, setNewLink] = useState<{ email: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
    users.reload();
    invitations.reload();
  }

  const updateUser = (id: string, body: { role?: RoleName; isActive?: boolean }) =>
    run(async () => {
      await api(`/users/${id}`, { method: 'PATCH', body });
      // Demoting yourself: refresh roles so the nav and AdminOnly route move you off this page.
      if (id === me.userId) await reloadMe();
    });

  const resend = (inv: Invitation) =>
    run(async () => {
      const res = await api<{ email: string; token: string }>('/invitations', {
        method: 'POST',
        body: { email: inv.email, fullName: inv.fullName, role: inv.role },
      });
      setNewLink(res);
    });

  const revoke = (inv: Invitation) => {
    if (!confirm(`ยกเลิกคำเชิญของ ${inv.email}? ลิงก์เดิมจะใช้ไม่ได้อีก`)) return;
    void run(() => api(`/invitations/${inv.id}`, { method: 'DELETE' }));
  };

  return (
    <>
      <PageHeader
        title="ผู้ใช้งาน"
        subtitle={users.data ? `${users.data.length} คน` : undefined}
        actions={
          !inviting && (
            <Button
              onClick={() => {
                setInviting(true);
                setNewLink(null);
              }}
            >
              + เชิญผู้ใช้
            </Button>
          )
        }
      />
      {newLink && <InviteLinkBox email={newLink.email} token={newLink.token} onClose={() => setNewLink(null)} />}
      {inviting && (
        <InviteForm
          onCancel={() => setInviting(false)}
          onInvited={(email, token) => {
            setInviting(false);
            setNewLink({ email, token });
            invitations.reload();
          }}
        />
      )}
      {(error || users.error || invitations.error) && (
        <div className="mb-4">
          <Alert>{error ?? users.error ?? invitations.error}</Alert>
        </div>
      )}
      {users.loading && !users.data && <Loading />}

      {users.data && (
        <Card className="mb-8 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">ชื่อ</th>
                <th className="px-4 py-2.5">สิทธิ์</th>
                <th className="px-4 py-2.5">สถานะ</th>
                <th className="px-4 py-2.5">เข้าระบบล่าสุด</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.map((u) => {
                const isMe = u.id === me.userId;
                const role = (u.roles.includes('Admin') ? 'Admin' : 'User') as RoleName;
                return (
                  <tr key={u.id} className={u.isActive ? undefined : 'text-slate-400'}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">
                        {u.fullName} {isMe && <span className="text-xs font-normal text-slate-400">(คุณ)</span>}
                      </div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <RoleSelect value={role} onChange={(r) => void updateUser(u.id, { role: r })} />
                    </td>
                    <td className="px-4 py-2.5">
                      {u.isActive ? <Badge tone="green">ใช้งาน</Badge> : <Badge tone="slate">ปิดใช้งาน</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{u.lastLoginAt ? dateOf(u.lastLoginAt) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {!isMe &&
                        (u.isActive ? (
                          <Button
                            variant="danger"
                            className="px-2.5 py-1 text-xs"
                            onClick={() => {
                              if (confirm(`ปิดการใช้งาน ${u.fullName}? ผู้ใช้จะถูกออกจากระบบทันที`)) void updateUser(u.id, { isActive: false });
                            }}
                          >
                            ปิดใช้งาน
                          </Button>
                        ) : (
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => void updateUser(u.id, { isActive: true })}>
                            เปิดใช้งาน
                          </Button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {invitations.data && invitations.data.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-semibold">คำเชิญที่รอตอบรับ</h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <tbody className="divide-y divide-slate-100">
                {invitations.data.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{inv.fullName}</div>
                      <div className="text-xs text-slate-500">{inv.email}</div>
                    </td>
                    <td className="px-4 py-2.5">{ROLE_LABELS[inv.role as RoleName] ?? inv.role}</td>
                    <td className="px-4 py-2.5">
                      {inv.expired ? <Badge tone="amber">หมดอายุ</Badge> : <span className="text-slate-500">หมดอายุ {dateOf(inv.expiresAt)}</span>}
                    </td>
                    <td className="space-x-2 whitespace-nowrap px-4 py-2.5 text-right">
                      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => void resend(inv)}>
                        สร้างลิงก์ใหม่
                      </Button>
                      <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => revoke(inv)}>
                        ยกเลิกคำเชิญ
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
