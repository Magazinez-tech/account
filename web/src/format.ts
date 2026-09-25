import type { AccountType } from './api';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'สินทรัพย์',
  liability: 'หนี้สิน',
  equity: 'ส่วนของเจ้าของ',
  revenue: 'รายได้',
  expense: 'ค่าใช้จ่าย',
};

export const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[];

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (amount: number | string) => money.format(Number(amount));

/** Accounting style: negatives in parentheses, e.g. (3,000.00). */
export const formatAmount = (amount: number) => (amount < 0 ? `(${money.format(-amount)})` : money.format(amount));

/** "1,234.5" -> 123450 satang; "" -> 0; anything invalid or with more than 2 decimals -> null. */
export function parseSatang(input: string): number | null {
  const s = input.replace(/,/g, '').trim();
  if (s === '') return 0;
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export const fromSatang = (satang: number) => satang / 100;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local date as YYYY-MM-DD (toISOString would shift to UTC). */
export const today = () => isoDate(new Date());

export const startOfMonth = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

/** First day of the fiscal year containing today; startMonth is 1-12. */
export function startOfFiscalYear(startMonth: number) {
  const d = new Date();
  const year = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  return isoDate(new Date(year, startMonth - 1, 1));
}

const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDate = (date: string) => dateFmt.format(new Date(`${date}T00:00:00`));
