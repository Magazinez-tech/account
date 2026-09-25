import { addDays, closingLines, fiscalYearContaining, isFiscalYearEnd, lastDayOfMonth, todayIn } from './fiscal-year';
import { AccountBalance } from './statements';

const acct = (id: string, type: AccountBalance['type'], net: number): AccountBalance => ({ accountId: id, code: id, name: id, type, net });

describe('fiscal year dates', () => {
  it('knows month lengths, including leap Februaries', () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calendar fiscal year (starts January)', () => {
    expect(fiscalYearContaining('2026-09-25', 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(fiscalYearContaining('2026-01-01', 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('October-September fiscal year', () => {
    expect(fiscalYearContaining('2026-09-25', 10)).toEqual({ start: '2025-10-01', end: '2026-09-30' });
    expect(fiscalYearContaining('2026-10-01', 10)).toEqual({ start: '2026-10-01', end: '2027-09-30' });
  });

  it('March-February fiscal year ends on the last day of February', () => {
    expect(fiscalYearContaining('2027-06-15', 3)).toEqual({ start: '2027-03-01', end: '2028-02-29' });
  });

  it('recognises fiscal year ends only', () => {
    expect(isFiscalYearEnd('2025-12-31', 1)).toBe(true);
    expect(isFiscalYearEnd('2025-12-30', 1)).toBe(false);
    expect(isFiscalYearEnd('2026-09-30', 10)).toBe(true);
    expect(isFiscalYearEnd('2025-12-31', 10)).toBe(false);
    expect(isFiscalYearEnd('not-a-date', 1)).toBe(false);
  });

  it('computes today in Thailand, not UTC', () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in Bangkok (UTC+7)
    expect(todayIn('Asia/Bangkok', new Date('2025-12-31T20:00:00Z'))).toBe('2026-01-01');
    expect(todayIn('UTC', new Date('2025-12-31T20:00:00Z'))).toBe('2025-12-31');
  });
});

describe('closingLines', () => {
  it('zeroes revenue and expenses into retained earnings on a profit', () => {
    const { lines, netIncome } = closingLines(
      [acct('cash', 'asset', 1070000), acct('sales', 'revenue', -1000000), acct('rent', 'expense', 300000), acct('vat', 'liability', -70000)],
      'RE',
    );
    expect(netIncome).toBe(700000);
    expect(lines).toEqual([
      { accountId: 'sales', debit: 1000000, credit: 0 },
      { accountId: 'rent', debit: 0, credit: 300000 },
      { accountId: 'RE', debit: 0, credit: 700000 },
    ]);
    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBe(credits);
  });

  it('debits retained earnings on a loss', () => {
    const { lines, netIncome } = closingLines([acct('sales', 'revenue', -100000), acct('rent', 'expense', 500000)], 'RE');
    expect(netIncome).toBe(-400000);
    expect(lines.at(-1)).toEqual({ accountId: 'RE', debit: 400000, credit: 0 });
  });

  it('closes contra balances the other way round', () => {
    // A revenue account with a debit balance (e.g. sales returns) is credited to close it.
    const { lines } = closingLines([acct('sales', 'revenue', -500000), acct('returns', 'revenue', 20000)], 'RE');
    expect(lines).toContainEqual({ accountId: 'returns', debit: 0, credit: 20000 });
    expect(lines.at(-1)).toEqual({ accountId: 'RE', debit: 0, credit: 480000 });
  });

  it('skips retained earnings when the year broke even', () => {
    const { lines, netIncome } = closingLines([acct('sales', 'revenue', -100000), acct('rent', 'expense', 100000)], 'RE');
    expect(netIncome).toBe(0);
    expect(lines).toHaveLength(2);
  });

  it('returns nothing when no revenue or expense has a balance', () => {
    expect(closingLines([acct('cash', 'asset', 100), acct('sales', 'revenue', 0)], 'RE')).toEqual({ lines: [], netIncome: 0 });
  });
});
