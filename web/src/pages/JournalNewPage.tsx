import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Account, type FiscalYearStatus, type JournalEntry } from '../api';
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, addDays, formatDate, formatMoney, fromSatang, parseSatang, today } from '../format';
import { Alert, Button, Card, cx, Field, Input, Loading, PageHeader, Select } from '../ui';
import { useApi } from '../useApi';

interface LineDraft {
  key: number;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

let nextKey = 1;
const blankLine = (): LineDraft => ({ key: nextKey++, accountId: '', description: '', debit: '', credit: '' });
const isBlank = (l: LineDraft) => !l.accountId && !l.description.trim() && !l.debit.trim() && !l.credit.trim();

/** Mirrors the server's rules so the user sees problems before submitting. */
function checkLine(l: LineDraft): { debit: number; credit: number; problem: string | null } {
  const debit = parseSatang(l.debit);
  const credit = parseSatang(l.credit);
  if (debit === null || credit === null) return { debit: 0, credit: 0, problem: 'จำนวนเงินไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)' };
  if (!l.accountId) return { debit, credit, problem: 'เลือกบัญชี' };
  if ((debit > 0) === (credit > 0)) return { debit, credit, problem: 'ใส่เดบิตหรือเครดิตอย่างใดอย่างหนึ่ง' };
  return { debit, credit, problem: null };
}

function AccountSelect({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange(id: string): void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="บัญชี">
      <option value="">เลือกบัญชี…</option>
      {ACCOUNT_TYPES.map((t) => (
        <optgroup key={t} label={ACCOUNT_TYPE_LABELS[t]}>
          {accounts
            .filter((a) => a.type === t && a.isActive)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

export default function JournalNewPage() {
  const navigate = useNavigate();
  const { data: accounts, error: loadError } = useApi<Account[]>('/accounts');
  const { data: fiscal } = useApi<FiscalYearStatus>('/fiscal-years');
  const [entryDate, setEntryDate] = useState(today);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const filled = lines.filter((l) => !isBlank(l));
  const checked = new Map(filled.map((l) => [l.key, checkLine(l)]));
  const totalDebit = [...checked.values()].reduce((s, c) => s + c.debit, 0);
  const totalCredit = [...checked.values()].reduce((s, c) => s + c.credit, 0);
  const difference = totalDebit - totalCredit;
  const allValid = [...checked.values()].every((c) => !c.problem);
  const closedThrough = fiscal?.closedThrough ?? null;
  const inClosedYear = closedThrough !== null && entryDate !== '' && entryDate <= closedThrough;
  const canSubmit = filled.length >= 2 && allValid && difference === 0 && totalDebit > 0 && !inClosedYear;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await api<JournalEntry>('/journal-entries', {
        method: 'POST',
        body: {
          entryDate,
          reference: reference.trim() || undefined,
          description: description.trim() || undefined,
          lines: filled.map((l) => {
            const c = checked.get(l.key)!;
            return {
              accountId: l.accountId,
              description: l.description.trim() || undefined,
              ...(c.debit > 0 ? { debit: fromSatang(c.debit) } : { credit: fromSatang(c.credit) }),
            };
          }),
        },
      });
      navigate('/journal', { state: { created: entry.entryNo } });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!accounts) return <Loading />;

  return (
    <form onSubmit={submit}>
      <PageHeader title="บันทึกรายการบัญชี" subtitle="ยอดเดบิตต้องเท่ากับยอดเครดิต" />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card className="mb-6 grid gap-4 p-5 sm:grid-cols-[10rem_12rem_1fr]">
        <Field label="วันที่">
          <Input
            type="date"
            value={entryDate}
            min={closedThrough ? addDays(closedThrough, 1) : undefined}
            onChange={(e) => setEntryDate(e.target.value)}
            required
            aria-invalid={inClosedYear}
            className={inClosedYear ? 'border-red-400' : undefined}
          />
          {inClosedYear && <span className="mt-1 block text-xs text-red-600">ปิดบัญชีถึง {formatDate(closedThrough!)} แล้ว</span>}
        </Field>
        <Field label="เลขที่อ้างอิง">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder="เช่น INV-0001" />
        </Field>
        <Field label="คำอธิบาย">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">บัญชี</th>
              <th className="px-3 py-2.5">รายละเอียด</th>
              <th className="w-36 px-3 py-2.5 text-right">เดบิต</th>
              <th className="w-36 px-3 py-2.5 text-right">เครดิต</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const problem = checked.get(l.key)?.problem;
              return (
                <tr key={l.key} className="align-top">
                  <td className="px-3 py-2.5 pt-4 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <AccountSelect accounts={accounts} value={l.accountId} onChange={(accountId) => update(l.key, { accountId })} />
                    {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} aria-label="รายละเอียด" />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.debit}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-label="เดบิต"
                      onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.credit}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-label="เครดิต"
                      onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                    />
                  </td>
                  <td className="px-1 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2"
                      aria-label={`ลบบรรทัด ${i + 1}`}
                      disabled={lines.length <= 2}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
            <tr>
              <td colSpan={3} className="px-3 py-3">
                <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  + เพิ่มบรรทัด
                </Button>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(fromSatang(totalDebit))}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(fromSatang(totalCredit))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className={cx('text-sm font-medium', difference === 0 && totalDebit > 0 ? 'text-emerald-700' : 'text-amber-700')}>
          {totalDebit === 0 && totalCredit === 0
            ? 'ยังไม่มีจำนวนเงิน'
            : difference === 0
              ? '✓ ยอดดุล'
              : `ผลต่าง ${formatMoney(fromSatang(Math.abs(difference)))} (${difference > 0 ? 'เดบิตมากกว่า' : 'เครดิตมากกว่า'})`}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/journal')}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={!canSubmit || busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกรายการ'}
          </Button>
        </div>
      </div>
    </form>
  );
}
