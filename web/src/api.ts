// Thin fetch wrapper for the NestJS API. Tokens live in localStorage; a 401 triggers one
// refresh attempt, and if that fails the session is cleared and 'auth:logout' is dispatched.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isActive: boolean;
}

export interface JournalLine {
  id: string;
  accountId: string;
  description: string | null;
  debit: string; // numeric columns arrive as strings, e.g. "10700.00"
  credit: string;
  lineNo: number;
}

export interface JournalEntry {
  id: string;
  entryNo: number;
  entryDate: string;
  description: string | null;
  reference: string | null;
  status: 'draft' | 'posted' | 'void';
  createdAt: string;
  lines: JournalLine[];
}

export interface TrialBalance {
  asOf: string | null;
  accounts: { accountId: string; code: string; name: string; type: AccountType; debit: number; credit: number }[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface StatementSection {
  accounts: { accountId: string; code: string; name: string; amount: number }[];
  total: number;
}

export interface IncomeStatement {
  from: string | null;
  to: string | null;
  revenue: StatementSection;
  expenses: StatementSection;
  netIncome: number;
}

export interface BalanceSheet {
  asOf: string | null;
  assets: StatementSection;
  liabilities: StatementSection;
  /** total includes currentEarnings (revenue - expenses to date; there are no closing entries yet) */
  equity: StatementSection & { currentEarnings: number };
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}

export interface Me {
  userId: string;
  email: string;
  fullName: string;
  tenantId: string;
  roles: string[];
}

export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  company: { name: string; taxId: string | null; currency: string; fiscalYearStartMonth: number } | null;
  subscription: { status: string; trialEndsAt: string | null } | null;
}

export type RoleName = 'Admin' | 'User';

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: string[];
}

export interface Invitation {
  id: string;
  email: string;
  fullName: string;
  role: string;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

export interface InvitePreview {
  email: string;
  fullName: string;
  companyName: string;
  tenantSlug: string;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface BillingStatus {
  status: SubscriptionStatus;
  /** Trial over or unpaid: the API refuses writes (402) except billing. */
  readOnly: boolean;
  plan: { code: string; name: string; maxUsers: number | null } | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingOverview extends BillingStatus {
  vatRate: number;
  plans: { code: string; name: string; maxUsers: number | null; priceMonthly: number; vatAmount: number; total: number }[];
  invoices: {
    id: string;
    invoiceNo: string;
    description: string | null;
    subtotal: number;
    vatAmount: number;
    amount: number;
    status: 'draft' | 'open' | 'paid' | 'void';
    paymentStatus: 'pending' | 'succeeded' | 'failed' | null;
    issuedAt: string | null;
    paidAt: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  }[];
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ACCESS_KEY = 'acc.accessToken';
const REFRESH_KEY = 'acc.refreshToken';

export const session = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(t: Tokens) {
    localStorage.setItem(ACCESS_KEY, t.accessToken);
    localStorage.setItem(REFRESH_KEY, t.refreshToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Thai text for server messages a user is likely to see; anything else is shown as sent. */
const THAI_MESSAGES: Record<string, string> = {
  'Invalid credentials': 'รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง',
  'Slug is already taken': 'รหัสบริษัทนี้ถูกใช้แล้ว',
  'Requires role: Admin': 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น',
  'A user with this email already exists': 'มีผู้ใช้อีเมลนี้อยู่แล้ว',
  'An invitation for this email is already pending': 'มีคำเชิญของอีเมลนี้ค้างอยู่แล้ว',
  'Invitation is invalid or has expired': 'ลิงก์คำเชิญไม่ถูกต้อง ถูกยกเลิก หรือหมดอายุแล้ว',
  'At least one active Admin is required': 'ต้องมีผู้ดูแลระบบ (Admin) ที่ใช้งานอยู่อย่างน้อย 1 คน',
  'You cannot deactivate yourself': 'ปิดการใช้งานบัญชีของตัวเองไม่ได้',
  'Subscription inactive': 'บัญชีอยู่ในโหมดอ่านอย่างเดียว ต้องชำระค่าบริการก่อนจึงจะบันทึกหรือแก้ไขข้อมูลได้',
  'Plan user limit reached': 'จำนวนผู้ใช้ครบตามแพ็กเกจแล้ว อัปเกรดแพ็กเกจเพื่อเพิ่มผู้ใช้',
  'Charge not found': 'ไม่พบรายการชำระเงิน',
  'Too many failed login attempts': 'ใส่รหัสผ่านผิดหลายครั้งเกินไป บัญชีนี้ถูกล็อกชั่วคราว กรุณาลองใหม่ภายใน 15 นาที',
  'Too many requests': 'มีการเรียกใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
};

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    // Nest validation errors come back as an array of messages.
    if (body?.message) message = Array.isArray(body.message) ? body.message.join(', ') : String(body.message);
  } catch {
    // not JSON; keep the status text
  }
  return new ApiError(res.status, THAI_MESSAGES[message] ?? message);
}

let refreshing: Promise<boolean> | null = null;

/** Concurrent 401s share one refresh request. */
function refreshTokens(): Promise<boolean> {
  const refreshToken = session.refresh;
  if (!refreshToken) return Promise.resolve(false);
  refreshing ??= fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) return false;
      session.save(await res.json());
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const send = () => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && session.access) headers.Authorization = `Bearer ${session.access}`;
    return fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };

  let res = await send();
  if (res.status === 401 && auth) {
    if (await refreshTokens()) {
      res = await send();
    }
    if (res.status === 401) {
      session.clear();
      window.dispatchEvent(new Event('auth:logout'));
    }
  }
  if (!res.ok) throw await errorFrom(res);
  return res.status === 204 ? (undefined as T) : res.json();
}
