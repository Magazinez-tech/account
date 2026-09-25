import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, session, type Me, type Tokens } from './api';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; loggedOut?: boolean } // loggedOut: the user clicked logout (vs. session expired)
  | { status: 'authenticated'; me: Me };

interface AuthContextValue {
  state: AuthState;
  login(tenantSlug: string, email: string, password: string): Promise<void>;
  /** Stores tokens from signup (or login) and loads the current user. */
  startSession(tokens: Tokens): Promise<void>;
  logout(): void;
  /** Re-fetches the current user, e.g. after an admin changes their own role. */
  reloadMe(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const LAST_SLUG_KEY = 'acc.lastTenantSlug';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (session.access ? { status: 'loading' } : { status: 'anonymous' }));

  const loadMe = useCallback(async () => {
    try {
      setState({ status: 'authenticated', me: await api<Me>('/auth/me') });
    } catch {
      session.clear();
      setState({ status: 'anonymous' });
    }
  }, []);

  useEffect(() => {
    if (session.access) void loadMe();
    const onLogout = () => setState({ status: 'anonymous' });
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [loadMe]);

  const startSession = useCallback(
    async (tokens: Tokens) => {
      session.save(tokens);
      await loadMe();
    },
    [loadMe],
  );

  const login = useCallback(
    async (tenantSlug: string, email: string, password: string) => {
      const tokens = await api<Tokens>('/auth/login', { method: 'POST', auth: false, body: { tenantSlug, email, password } });
      localStorage.setItem(LAST_SLUG_KEY, tenantSlug);
      await startSession(tokens);
    },
    [startSession],
  );

  const logout = useCallback(() => {
    session.clear();
    setState({ status: 'anonymous', loggedOut: true });
  }, []);

  return <AuthContext.Provider value={{ state, login, startSession, logout, reloadMe: loadMe }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * Mirrors the API's Admin-only endpoints (create account, void entry) so the UI hides actions
 * that would 403. The server is the real check.
 */
export const isAdmin = (me: Me) => me.roles.includes('Admin');

/** Only valid inside routes guarded by RequireAuth. */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useMe called while signed out');
  return state.me;
}
