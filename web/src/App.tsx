import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { TenantDetail } from './api';
import { AuthProvider, isAdmin, useAuth, useMe } from './auth';
import AcceptInvitePage from './pages/AcceptInvitePage';
import AccountsPage from './pages/AccountsPage';
import BalanceSheetPage from './pages/BalanceSheetPage';
import IncomeStatementPage from './pages/IncomeStatementPage';
import JournalListPage from './pages/JournalListPage';
import JournalNewPage from './pages/JournalNewPage';
import LoginPage from './pages/LoginPage';
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
  { to: '/journal', label: 'สมุดรายวัน' },
  { to: '/accounts', label: 'ผังบัญชี' },
  { to: '/trial-balance', label: 'งบทดลอง' },
  { to: '/income-statement', label: 'งบกำไรขาดทุน' },
  { to: '/balance-sheet', label: 'งบแสดงฐานะการเงิน' },
  { to: '/users', label: 'ผู้ใช้งาน', adminOnly: true },
];

/** Non-admins who land on an admin page (e.g. right after demoting themselves) go to the journal. */
function AdminOnly() {
  return isAdmin(useMe()) ? <Outlet /> : <Navigate to="/journal" replace />;
}

function Layout() {
  const me = useMe();
  const { logout } = useAuth();
  const nav = NAV.filter((n) => !n.adminOnly || isAdmin(me));
  const { data: tenant } = useApi<TenantDetail>(`/tenants/${me.tenantId}`);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{tenant?.company?.name ?? tenant?.name ?? '…'}</div>
            {tenant?.subscription?.status === 'trialing' && tenant.subscription.trialEndsAt && (
              <div className="text-xs text-slate-500">
                ทดลองใช้ถึง {new Date(tenant.subscription.trialEndsAt).toLocaleDateString('th-TH')}
              </div>
            )}
          </div>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
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
            <span className="hidden text-slate-600 md:inline">
              {me.fullName} <span className="text-slate-400">· {me.roles.join(', ')}</span>
            </span>
            <Button variant="ghost" onClick={logout}>
              ออกจากระบบ
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
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
            <Route element={<AdminOnly />}>
              <Route path="/users" element={<UsersPage />} />
            </Route>
          </Route>
          {/* Outside both guards: an invite link works whether or not someone is signed in on this browser. */}
          <Route path="/invite/:token" element={<AcceptInvitePage />} />
          <Route path="*" element={<Navigate to="/journal" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
