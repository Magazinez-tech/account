import { useState, type FormEvent } from 'react';
import { api, type Account, type AccountType } from '../api';
import { isAdmin, useMe } from '../auth';
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES } from '../format';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Select } from '../ui';
import { useApi } from '../useApi';

function NewAccountForm({ accounts, onCreated, onCancel }: { accounts: Account[]; onCreated(a: Account): void; onCancel(): void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<Account>('/accounts', {
        method: 'POST',
        body: { code: code.trim(), name: name.trim(), type, parentId: parentId || undefined },
      });
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold">เพิ่มบัญชี</h2>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="รหัสบัญชี">
            <Input value={code} onChange={(e) => setCode(e.target.value)} required pattern="[0-9A-Za-z.\-]{1,20}" placeholder="เช่น 1020" />
          </Field>
          <Field label="ชื่อบัญชี">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </Field>
          <Field label="หมวด">
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value as AccountType);
                setParentId('');
              }}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="บัญชีแม่ (ไม่บังคับ)">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">—</option>
              {accounts
                .filter((a) => a.type === type)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
            </Select>
          </Field>
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

export default function AccountsPage() {
  const canEdit = isAdmin(useMe());
  const { data: accounts, error, loading, reload } = useApi<Account[]>('/accounts');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = new Map((accounts ?? []).map((a) => [a.id, a]));

  return (
    <>
      <PageHeader
        title="ผังบัญชี"
        subtitle={accounts ? `${accounts.length} บัญชี` : undefined}
        actions={
          canEdit &&
          !adding && (
            <Button
              onClick={() => {
                setAdding(true);
                setNotice(null);
              }}
            >
              + เพิ่มบัญชี
            </Button>
          )
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {adding && accounts && (
        <NewAccountForm
          accounts={accounts}
          onCancel={() => setAdding(false)}
          onCreated={(a) => {
            setAdding(false);
            setNotice(`เพิ่มบัญชี ${a.code} ${a.name} แล้ว`);
            reload();
          }}
        />
      )}
      {error && <Alert>{error}</Alert>}
      {loading && !accounts && <Loading />}
      {accounts && (
        <div className="space-y-6">
          {ACCOUNT_TYPES.map((type) => {
            const rows = accounts.filter((a) => a.type === type);
            if (rows.length === 0) return null;
            return (
              <Card key={type} className="overflow-hidden">
                <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">
                  {ACCOUNT_TYPE_LABELS[type]}
                </h2>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <td className="w-28 px-4 py-2.5 font-mono text-slate-500">{a.code}</td>
                        <td className="px-4 py-2.5">
                          {a.name}
                          {a.parentId && byId.get(a.parentId) && (
                            <span className="ml-2 text-xs text-slate-400">ภายใต้ {byId.get(a.parentId)!.code}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">{!a.isActive && <Badge tone="slate">ปิดใช้งาน</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
