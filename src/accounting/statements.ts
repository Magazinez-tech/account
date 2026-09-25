import { fromSatang } from '../common/money';
import { AccountType } from '../database/entities';

/** One account's posted activity over some date range. */
export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  /** debit - credit, in satang */
  net: number;
}

/** Accounts of one type with non-zero balances. sign flips credit-normal types so their balances read positive. */
export function section(balances: AccountBalance[], type: AccountType, sign: 1 | -1) {
  const accounts = balances
    .filter((b) => b.type === type && b.net !== 0)
    .map((b) => ({ accountId: b.accountId, code: b.code, name: b.name, amount: sign * b.net }));
  return { accounts, total: accounts.reduce((s, a) => s + a.amount, 0) };
}

function toMoney(s: ReturnType<typeof section>) {
  return { accounts: s.accounts.map((a) => ({ ...a, amount: fromSatang(a.amount) })), total: fromSatang(s.total) };
}

/** Each account's net balance on its debit or credit side; zero-balance accounts are left out. */
export function buildTrialBalance(balances: AccountBalance[], asOf?: string) {
  let totalDebit = 0;
  let totalCredit = 0;
  const accounts = balances
    .filter((a) => a.net !== 0)
    .map(({ net, ...a }) => {
      const debit = Math.max(net, 0);
      const credit = Math.max(-net, 0);
      totalDebit += debit;
      totalCredit += credit;
      return { ...a, debit: fromSatang(debit), credit: fromSatang(credit) };
    });

  return {
    asOf: asOf ?? null,
    accounts,
    totalDebit: fromSatang(totalDebit),
    totalCredit: fromSatang(totalCredit),
    balanced: totalDebit === totalCredit,
  };
}

/** Revenue and expenses for a period. Amounts are positive in each section's normal direction. */
export function buildIncomeStatement(balances: AccountBalance[], range: { from?: string; to?: string }) {
  const revenue = section(balances, 'revenue', -1);
  const expenses = section(balances, 'expense', 1);
  return {
    from: range.from ?? null,
    to: range.to ?? null,
    revenue: toMoney(revenue),
    expenses: toMoney(expenses),
    netIncome: fromSatang(revenue.total - expenses.total),
  };
}

/**
 * Financial position from cumulative balances. There are no closing entries yet, so cumulative
 * revenue minus expenses shows up as current earnings inside equity; that keeps assets = liabilities + equity.
 */
export function buildBalanceSheet(balances: AccountBalance[], asOf?: string) {
  const assets = section(balances, 'asset', 1);
  const liabilities = section(balances, 'liability', -1);
  const equity = section(balances, 'equity', -1);
  const currentEarnings = section(balances, 'revenue', -1).total - section(balances, 'expense', 1).total;
  const totalEquity = equity.total + currentEarnings;

  return {
    asOf: asOf ?? null,
    assets: toMoney(assets),
    liabilities: toMoney(liabilities),
    equity: { ...toMoney(equity), currentEarnings: fromSatang(currentEarnings), total: fromSatang(totalEquity) },
    totalLiabilitiesAndEquity: fromSatang(liabilities.total + totalEquity),
    balanced: assets.total === liabilities.total + totalEquity,
  };
}
