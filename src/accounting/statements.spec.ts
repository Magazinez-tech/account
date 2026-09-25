import { AccountBalance, buildBalanceSheet, buildIncomeStatement, buildTrialBalance, section } from './statements';

const acct = (code: string, type: AccountBalance['type'], net: number): AccountBalance => ({
  accountId: `id-${code}`,
  code,
  name: `Account ${code}`,
  type,
  net,
});

// The smoke test's tenant A in satang: owner capital 100,000, cash sale 10,700 incl. VAT, salaries 3,000.
const BOOKS: AccountBalance[] = [
  acct('1000', 'asset', 1070000), // cash
  acct('1010', 'asset', 9700000), // bank: +100,000 capital, -3,000 salaries
  acct('1200', 'asset', 0), // no activity
  acct('2100', 'liability', -70000), // output VAT
  acct('3000', 'equity', -10000000), // capital
  acct('4000', 'revenue', -1000000), // sales
  acct('5100', 'expense', 300000), // salaries
];

describe('section', () => {
  it('flips credit-normal balances to positive and drops zero balances', () => {
    const revenue = section(BOOKS, 'revenue', -1);
    expect(revenue).toEqual({ accounts: [{ accountId: 'id-4000', code: '4000', name: 'Account 4000', amount: 1000000 }], total: 1000000 });
    expect(section(BOOKS, 'asset', 1).accounts.map((a) => a.code)).toEqual(['1000', '1010']);
  });

  it('keeps contra balances negative', () => {
    const overdrawn = section([acct('1010', 'asset', -500000)], 'asset', 1);
    expect(overdrawn.total).toBe(-500000);
  });
});

describe('buildTrialBalance', () => {
  it('puts each account on its debit or credit side and balances', () => {
    const tb = buildTrialBalance(BOOKS, '2026-09-30');
    expect(tb.asOf).toBe('2026-09-30');
    expect(tb.accounts).toHaveLength(6);
    expect(tb.accounts.find((a) => a.code === '2100')).toMatchObject({ debit: 0, credit: 700 });
    expect(tb.accounts.find((a) => a.code === '1000')).toMatchObject({ debit: 10700, credit: 0 });
    expect(tb).toMatchObject({ totalDebit: 110700, totalCredit: 110700, balanced: true });
  });

  it('reports an unbalanced ledger', () => {
    expect(buildTrialBalance([acct('1000', 'asset', 100)]).balanced).toBe(false);
  });

  it('returns null asOf and no accounts for empty books', () => {
    expect(buildTrialBalance([])).toEqual({ asOf: null, accounts: [], totalDebit: 0, totalCredit: 0, balanced: true });
  });
});

describe('buildIncomeStatement', () => {
  it('computes net income from revenue and expenses', () => {
    const is = buildIncomeStatement(BOOKS, { from: '2026-09-01', to: '2026-09-30' });
    expect(is.revenue.total).toBe(10000);
    expect(is.expenses.total).toBe(3000);
    expect(is.netIncome).toBe(7000);
    expect(is).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('shows a loss as negative net income', () => {
    expect(buildIncomeStatement([acct('5200', 'expense', 500000)], {}).netIncome).toBe(-5000);
  });
});

describe('buildBalanceSheet', () => {
  it('balances by carrying profit to date as current earnings', () => {
    const bs = buildBalanceSheet(BOOKS);
    expect(bs.assets.total).toBe(107700);
    expect(bs.liabilities.total).toBe(700);
    expect(bs.equity.currentEarnings).toBe(7000);
    expect(bs.equity.total).toBe(107000); // 100,000 capital + 7,000 earnings
    expect(bs.totalLiabilitiesAndEquity).toBe(107700);
    expect(bs.balanced).toBe(true);
  });

  it('still balances with a loss and a negative asset', () => {
    const bs = buildBalanceSheet([acct('1010', 'asset', -500000), acct('5200', 'expense', 500000)]);
    expect(bs.assets.total).toBe(-5000);
    expect(bs.equity.currentEarnings).toBe(-5000);
    expect(bs.balanced).toBe(true);
  });
});
