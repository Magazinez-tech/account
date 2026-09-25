import { useEffect } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { BillingStatus, SubscriptionStatus, TenantDetail } from './api';
import { AuthProvider, isAdmin, useAuth, useMe } from './auth';
import { BILLING_CHANGED } from './billing-events';
import AcceptInvitePage from './pages/AcceptInvitePage';
import AccountsPage from './pages/AccountsPage';
import BalanceSheetPage from './pages/BalanceSheetPage';
import BillingPage from './pages/BillingPage';
import ClosingPage from './pages/ClosingPage';
import CompanyPage from './pages/CompanyPage';
import CustomersPage from './pages/CustomersPage';
import IncomeStatementPage from './pages/IncomeStatementPage';
import JournalListPage from './pages/JournalListPage';
import JournalNewPage from './pages/JournalNewPage';
import LoginPage from './pages/LoginPage';
import MockCheckoutPage from './pages/MockCheckoutPage';
import SalesDocumentFormPage from './pages/SalesDocumentFormPage';
import SalesDocumentListPage from './pages/SalesDocumentListPage';
import SalesDocumentPage from './pages/SalesDocumentPage';
import TaxInvoicePage from './pages/TaxInvoicePage';
import SignupPage from './pages/SignupPage';
import TrialBalancePage from './pages/TrialBalancePage';
import UsersPage from './pages/UsersPage';
import { Button, cx, Loading } from './ui';
import { useApi } from './useApi';

function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'anonymous') {
    // After an expired session, come back here once signed in; after a deliberate logout, start fresh.
    return <Navigate to="/login" replace state={state.loggedOut ? null : { from: location.pathname }} />;
  }
  return <Layout />;
}

function PublicOnly() {
  const { state } = useAuth();
  const from = (useLocation().state as { from?: string } | null)?.from;
  if (state.status === 'loading') return <Loading />;
  // Signing in flips auth state; send the user back to where RequireAuth bounced them from.
  if (state.status === 'authenticated') return <Navigate to={from ?? '/journal'} replace />;
  return <Outlet />;
}

const NAV = [
  { to: '/quotations', label: 'ใบเสนอราคา' },
  { to: '/billing-notes', label: 'ใบวางบิล' },
  { to: '/customers', label: 'ลูกค้า' },
  { to: '/journal', label: 'สมุดรายวัน' },
  { to: '/accounts', label: 'ผังบัญชี' },
  { to: '/trial-balance', label: 'งบทดลอง' },
  { to: '/income-statement', label: 'งบกำไรขาดทุน' },
  { to: '/balance-sheet', label: 'งบฐานะการเงิน' },
  { to: '/company', label: 'ข้อมูลบริษัท', adminOnly: true },
  { to: '/users', label: 'ผู้ใช้งาน', adminOnly: true },
  { to: '/billing', label: 'การชำระเงิน', adminOnly: true },
];

const READ_ONLY_REASON: Partial<Record<SubscriptionStatus, string>> = {
  expired: 'หมดช่วงทดลองใช้แล้ว',
  past_due: 'เลยกำหนดชำระค่าบริการ',
  canceled: 'ยกเลิกแพ็กเกจแล้ว',
};

const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

/** One-line plan summary under the company name. */
function planLine(b: BillingStatus): string {
  const plan = b.plan?.name ?? '';
  if (b.status === 'trialing' && b.trialEndsAt) return `ทดลองใช้ ${plan} · เหลือ ${daysUntil(b.trialEndsAt)} วัน`;
  if (b.status === 'active' && b.currentPeriodEnd) {
    const end = new Date(b.currentPeriodEnd).toLocaleDateString('th-TH');
    return b.cancelAtPeriodEnd ? `${plan} · ใช้ได้ถึง ${end}` : `${plan} · ต่ออายุ ${end}`;
  }
  return `${plan} · ${READ_ONLY_REASON[b.status] ?? ''}`;
}

/** Non-admins who land on an admin page (e.g. right after demoting themselves) go to the journal. */
function AdminOnly() {
  return isAdmin(useMe()) ? <Outlet /> : <Navigate to="/journal" replace />;
}

function Layout() {
  const me = useMe();
  const { logout } = useAuth();
  const nav = NAV.filter((n) => !n.adminOnly || isAdmin(me));
  const { data: tenant } = useApi<TenantDetail>(`/tenants/${me.tenantId}`);
  const { data: billing, reload: reloadBilling } = useApi<BillingStatus>('/billing/status');

  // Pages that change the subscription without a full page load (PromptPay QR, cancel/resume) announce it.
  useEffect(() => {
    window.addEventListener(BILLING_CHANGED, reloadBilling);
    return () => window.removeEventListener(BILLING_CHANGED, reloadBilling);
  }, [reloadBilling]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{tenant?.company?.name ?? tenant?.name ?? '…'}</div>
            {billing && <div className="text-xs text-slate-500">{planLine(billing)}</div>}
          </div>
          <nav className="order-last flex w-full gap-1 overflow-x-auto">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
                    isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden max-w-44 truncate text-slate-600 md:inline" title={`${me.fullName} · ${me.roles.join(', ')}`}>
              {me.fullName} <span className="text-slate-400">· {me.roles.join(', ')}</span>
            </span>
            <Button variant="ghost" onClick={logout}>
              ออกจากระบบ
            </Button>
          </div>
        </div>
      </header>
      {billing?.readOnly && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm text-amber-900">
            <span>
              {READ_ONLY_REASON[billing.status] ?? 'บัญชีไม่ได้ใช้งาน'} · ดูข้อมูลได้ แต่บันทึกหรือแก้ไขไม่ได้จนกว่าจะชำระค่าบริการ
            </span>
            {isAdmin(me) ? (
              <Link to="/billing" className="font-semibold underline underline-offset-2">
                ชำระค่าบริการ
              </Link>
            ) : (
              <span className="font-medium">กรุณาติดต่อผู้ดูแลระบบของบริษัท</span>
            )}
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8 print:max-w-none print:p-0">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/journal" element={<JournalListPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/trial-balance" element={<TrialBalancePage />} />
            <Route path="/income-statement" element={<IncomeStatementPage />} />
            <Route path="/balance-sheet" element={<BalanceSheetPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/company" element={<CompanyPage />} />
            {(['quotation', 'billing_note'] as const).map((t) => {
              const base = t === 'quotation' ? '/quotations' : '/billing-notes';
              return [
                <Route key={`${t}-list`} path={base} element={<SalesDocumentListPage key={t} docType={t} />} />,
                <Route key={`${t}-new`} path={`${base}/new`} element={<SalesDocumentFormPage key={`${t}-new`} docType={t} />} />,
                <Route key={`${t}-view`} path={`${base}/:id`} element={<SalesDocumentPage key={t} docType={t} />} />,
                <Route key={`${t}-edit`} path={`${base}/:id/edit`} element={<SalesDocumentFormPage key={`${t}-edit`} docType={t} />} />,
              ];
            })}
            <Route path="/billing-notes/:id/tax-invoice" element={<TaxInvoicePage />} />
            <Route element={<AdminOnly />}>
              <Route path="/users" element={<UsersPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/closing" element={<ClosingPage />} />
            </Route>
          </Route>
          {/* Outside both guards: an invite link works whether or not someone is signed in on this browser. */}
          <Route path="/invite/:token" element={<AcceptInvitePage />} />
          {/* Stands in for the payment provider's hosted page (PAYMENT_PROVIDER=mock). */}
          <Route path="/billing/mock-checkout/:chargeId" element={<MockCheckoutPage />} />
          <Route path="*" element={<Navigate to="/journal" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
