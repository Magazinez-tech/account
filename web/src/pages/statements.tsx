import type { ReactNode } from 'react';
import type { StatementSection } from '../api';
import { formatAmount } from '../format';
import { cx } from '../ui';

/** One labelled block of accounts with a subtotal, e.g. "รายได้". */
export function SectionRows({
  title,
  section,
  totalLabel,
  extra,
}: {
  title: string;
  section: StatementSection;
  totalLabel: string;
  /** Rows appended after the accounts, before the subtotal (e.g. current earnings). */
  extra?: ReactNode;
}) {
  return (
    <tbody>
      <tr>
        <th colSpan={2} className="bg-slate-50 px-4 py-2.5 text-left text-sm font-semibold text-slate-700">
          {title}
        </th>
      </tr>
      {section.accounts.length === 0 && !extra && (
        <tr>
          <td colSpan={2} className="px-4 py-2.5 pl-8 text-sm text-slate-400">
            ไม่มีรายการ
          </td>
        </tr>
      )}
      {section.accounts.map((a) => (
        <AmountRow key={a.accountId} label={a.name} code={a.code} amount={a.amount} />
      ))}
      {extra}
      <tr className="border-t border-slate-200">
        <td className="px-4 py-2.5 text-sm font-medium">{totalLabel}</td>
        <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums">{formatAmount(section.total)}</td>
      </tr>
    </tbody>
  );
}

export function AmountRow({ label, code, amount, muted }: { label: string; code?: string; amount: number; muted?: boolean }) {
  return (
    <tr>
      <td className={cx('px-4 py-2 pl-8 text-sm', muted && 'italic text-slate-600')}>
        {code && <span className="mr-2 font-mono text-slate-500">{code}</span>}
        {label}
      </td>
      <td className={cx('w-44 px-4 py-2 text-right text-sm tabular-nums', amount < 0 && 'text-red-700')}>{formatAmount(amount)}</td>
    </tr>
  );
}

export function GrandTotal({ label, amount }: { label: string; amount: number }) {
  return (
    <tbody>
      <tr className="border-t-2 border-slate-300">
        <td className="px-4 py-3 font-semibold">{label}</td>
        <td className={cx('px-4 py-3 text-right font-semibold tabular-nums', amount < 0 && 'text-red-700')}>
          <span className="border-b-4 border-double border-slate-400 pb-0.5">{formatAmount(amount)}</span>
        </td>
      </tr>
    </tbody>
  );
}
