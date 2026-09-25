import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type Account, type FiscalYearStatus, type JournalEntry } from '../api';
import { isAdmin, useMe } from '../auth';
import { formatDate, formatMoney } from '../format';
import { Alert, Badge, Button, Card, cx, Field, Input, Loading, PageHeader } from '../ui';
import { useApi } from '../useApi';

/** onVoid is omitted for users who may not void entries. */
function EntryCard({
  entry,
  accounts,
  onVoid,
  locked,
}: {
  entry: JournalEntry;
  accounts: Map<string, Account>;
  onVoid?: () => Promise<void>;
  /** Dated inside a closed fiscal year. */
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const isVoid = entry.status === 'void';
  const total = entry.lines.reduce((s, l) => s + Number(l.debit), 0);

  async function voidEntry() {
    if (!confirm(`ยกเลิกรายการ JV-${entry.entryNo}? รายการที่ยกเลิกแล้วจะไม่ถูกนับในงบทดลอง`)) return;
    setBusy(true);
    try {
      await onVoid?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cx('overflow-hidden', isVoid && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3">
        <span className="font-mono text-sm font-semibold">JV-{entry.entryNo}</span>
        <span className="text-sm text-slate-600">{formatDate(entry.entryDate)}</span>
        {entry.reference && <span className="text-sm text-slate-500">อ้างอิง {entry.reference}</span>}
        {isVoid ? <Badge tone="red">ยกเลิกแล้ว</Badge> : <Badge tone="green">ผ่านรายการ</Badge>}
        {entry.kind === 'closing' && <Badge tone="slate">ปิดบัญชีสิ้นปี</Badge>}
        {locked && !isVoid && entry.kind !== 'closing' && <span className="text-xs text-slate-400">🔒 ปีบัญชีปิดแล้ว</span>}
        <span className="ml-auto text-sm font-medium tabular-nums">{formatMoney(total)}</span>
        {!isVoid && onVoid && !locked && entry.kind !== 'closing' && (
          <Button variant="danger" className="px-2.5 py-1 text-xs" disabled={busy} onClick={voidEntry}>
            ยกเลิกรายการ
          </Button>
        )}
      </div>
      {entry.description && <p className="px-4 pt-3 text-sm text-slate-700">{entry.description}</p>}
      <table className={cx('w-full text-sm', isVoid && 'line-through')}>
        <tbody>
          {entry.lines.map((l) => {
            const acct = accounts.get(l.accountId);
            const isCredit = Number(l.credit) > 0;
            return (
              <tr key={l.id}>
                <td className={cx('py-1.5 pl-4', isCredit && 'pl-8 sm:pl-10')}>
                  <span className="font-mono text-slate-500">{acct?.code}</span> {acct?.name ?? l.accountId}
                  {l.description && <span className="ml-2 text-slate-400">— {l.description}</span>}
                </td>
                <td className="w-24 whitespace-nowrap py-1.5 pl-2 text-right tabular-nums sm:w-36">{isCredit ? '' : formatMoney(l.debit)}</td>
                <td className="w-24 whitespace-nowrap py-1.5 pl-2 pr-4 text-right tabular-nums sm:w-36">{isCredit ? formatMoney(l.credit) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="h-2" />
    </Card>
  );
}

export default function JournalListPage() {
  const canVoid = isAdmin(useMe());
  const navigate = useNavigate();
  const location = useLocation();
  const created = (location.state as { created?: number } | null)?.created;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const qs = query.toString();

  const entries = useApi<JournalEntry[]>(`/journal-entries${qs ? `?${qs}` : ''}`);
  const accounts = useApi<Account[]>('/accounts');
  const fiscal = useApi<FiscalYearStatus>('/fiscal-years');
  const closedThrough = fiscal.data?.closedThrough ?? null;
  const accountMap = new Map((accounts.data ?? []).map((a) => [a.id, a]));

  async function voidEntry(id: string) {
    setActionError(null);
    try {
      await api(`/journal-entries/${id}/void`, { method: 'POST' });
      entries.reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="สมุดรายวันทั่วไป"
        subtitle="แสดงล่าสุด 200 รายการ"
        actions={
          <>
            {canVoid && (
              <Button variant="secondary" onClick={() => navigate('/closing')}>
                ปิดบัญชีสิ้นปี
              </Button>
            )}
            <Button onClick={() => navigate('/journal/new')}>+ บันทึกรายการ</Button>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {(from || to) && (
          <Button
            variant="ghost"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            ล้างตัวกรอง
          </Button>
        )}
      </div>
      <div className="space-y-4">
        {created !== undefined && <Alert tone="success">บันทึกรายการ JV-{created} แล้ว</Alert>}
        {(entries.error || accounts.error || actionError) && <Alert>{entries.error ?? accounts.error ?? actionError}</Alert>}
        {entries.loading && !entries.data && <Loading />}
        {entries.data?.length === 0 && (
          <Card className="p-10 text-center text-sm text-slate-500">
            ยังไม่มีรายการ{from || to ? 'ในช่วงวันที่นี้' : ''}
          </Card>
        )}
        {entries.data?.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            accounts={accountMap}
            locked={closedThrough !== null && e.entryDate <= closedThrough}
            onVoid={canVoid ? () => voidEntry(e.id) : undefined}
          />
        ))}
      </div>
    </>
  );
}
