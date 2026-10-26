import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import type { CurrentUser, RegistrationInput, Role } from './types';

export const ME_KEY = ['auth', 'me'] as const;

/** Current session user, or null when signed out. */
export function useAuth() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const r = await api.get<{ user: CurrentUser }>('/auth/me');
        return r.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
  });

  return {
    user: q.data ?? null,
    loading: q.isLoading,
    error: q.error,
    async login(email: string, password: string, remember: boolean) {
      const r = await api.post<{ user: CurrentUser }>('/auth/login', { email, password, remember });
      qc.clear();
      qc.setQueryData(ME_KEY, r.user);
      return r.user;
    },
    /**
     * Self-service sign-up. The API signs the new user in (session + CSRF cookies), but the cached user is only set
     * once the caller calls setUser, so the page can show its confirmation before redirecting into the app.
     */
    async register(input: RegistrationInput) {
      const r = await api.post<{ user: CurrentUser }>('/auth/register', input);
      return r.user;
    },
    async logout() {
      try {
        await api.post('/auth/logout');
      } finally {
        qc.clear();
        qc.setQueryData(ME_KEY, null);
      }
    },
    setUser(u: CurrentUser) {
      qc.setQueryData(ME_KEY, u);
    },
  };
}

export function hasRole(user: CurrentUser | null, ...roles: Role[]) {
  return !!user && roles.includes(user.role);
}

/** Redirects anonymous users to /login. Optionally restricts to roles (the API enforces the same rules). */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas" aria-busy="true">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          Loading MediChain…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
