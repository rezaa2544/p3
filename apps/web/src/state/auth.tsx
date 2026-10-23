import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, NetworkError, api, setApiContext, errorMessage } from '../lib/api.js';
import { clearAllLocalData } from '../lib/offline.js';
import type { Me } from '../lib/types.js';

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string, mfaCode?: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  switchSchool: (schoolId: string) => Promise<void>;
  has: (permission: string) => boolean;
  canRole: (...roles: string[]) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyMe = useCallback((next: Me, schoolId?: string) => {
    const active = schoolId ?? next.activeSchoolId ?? next.memberships[0]?.schoolId ?? null;
    setApiContext({ csrfToken: next.csrfToken, schoolId: active });
    setMe(active ? { ...next, activeSchoolId: active } : next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api<Me>('/auth/me');
      applyMe(next);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setApiContext({ csrfToken: null, schoolId: null });
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }, [applyMe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      setMe(null);
      setApiContext({ csrfToken: null, schoolId: null });
    };
    window.addEventListener('payesh:unauthorized', handler);
    return () => window.removeEventListener('payesh:unauthorized', handler);
  }, []);

  const login = useCallback(
    async (username: string, password: string, mfaCode?: string) => {
      setError(null);
      try {
        const res = await api<{
          csrfToken: string;
          memberships: { schoolId: string; role: string }[];
        }>('/auth/login', { method: 'POST', body: { username, password, mfaCode } });
        setApiContext({ csrfToken: res.csrfToken, schoolId: res.memberships[0]?.schoolId ?? null });
        await refresh();
        return { mfaRequired: false };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'MFA_REQUIRED') return { mfaRequired: true };
        if (e instanceof NetworkError) {
          setError('اتصال به سرور برقرار نشد. اتصال اینترنت را بررسی کنید.');
          throw e;
        }
        setError(errorMessage(e));
        throw e;
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* حتی در خطا، نشست محلی پاک می‌شود */
    }
    await clearAllLocalData();
    setApiContext({ csrfToken: null, schoolId: null });
    setMe(null);
  }, []);

  const switchSchool = useCallback(
    async (schoolId: string) => {
      if (!me) return;
      setApiContext({ schoolId });
      setMe({ ...me, activeSchoolId: schoolId });
      await refresh();
    },
    [me, refresh],
  );

  const has = useCallback(
    (permission: string) => Boolean(me && (me.user.isSuperAdmin || me.permissions.includes(permission))),
    [me],
  );
  const canRole = useCallback((...roles: string[]) => Boolean(me && roles.includes(me.role)), [me]);

  const value = useMemo<AuthState>(
    () => ({ me, loading, error, login, logout, refresh, switchSchool, has, canRole }),
    [me, loading, error, login, logout, refresh, switchSchool, has, canRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
