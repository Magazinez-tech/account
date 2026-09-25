import { AccountBalance } from './statements';

/** Fiscal-year arithmetic on YYYY-MM-DD strings (calendar dates, no time zones involved). */

const pad = (n: number) => String(n).padStart(2, '0');

function parse(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parse(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface FiscalYear {
  start: string;
  end: string;
}

/** The fiscal year containing `date`, for a year starting on day 1 of `startMonth` (1-12). */
export function fiscalYearContaining(date: string, startMonth: number): FiscalYear {
  const [y, m] = parse(date);
  const startYear = m >= startMonth ? y : y - 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  return {
    start: `${startYear}-${pad(startMonth)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(lastDayOfMonth(endYear, endMonth))}`,
  };
}

export function isFiscalYearEnd(date: string, startMonth: number): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && fiscalYearContaining(date, startMonth).end === date;
}

/** Today's calendar date in a time zone (default Asia/Bangkok), as YYYY-MM-DD. */
export function todayIn(timeZone = 'Asia/Bangkok', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Lines of a closing entry, in satang: every revenue and expense account with a balance is
 * brought to zero, and the difference goes to retained earnings (credit for a profit, debit for
 * a loss). Balances are cumulative through the year end, so any earlier year that was never
 * closed is swept in too. Returns no lines when there is nothing to close.
 */
export function closingLines(balances: AccountBalance[], retainedEarningsAccountId: string) {
  const lines: { accountId: string; debit: number; credit: number }[] = [];
  for (const b of balances) {
    if ((b.type !== 'revenue' && b.type !== 'expense') || b.net === 0) continue;
    // A debit balance is closed with a credit and vice versa.
    lines.push(b.net > 0 ? { accountId: b.accountId, debit: 0, credit: b.net } : { accountId: b.accountId, debit: -b.net, credit: 0 });
  }
  // The P&L accounts' combined balance (debit - credit) is minus the profit. `0 -` avoids a -0.
  const netIncome = 0 - balances.filter((b) => b.type === 'revenue' || b.type === 'expense').reduce((s, b) => s + b.net, 0);
  if (lines.length > 0 && netIncome !== 0) {
    lines.push(
      netIncome > 0
        ? { accountId: retainedEarningsAccountId, debit: 0, credit: netIncome }
        : { accountId: retainedEarningsAccountId, debit: -netIncome, credit: 0 },
    );
  }
  return { lines, netIncome };
}
