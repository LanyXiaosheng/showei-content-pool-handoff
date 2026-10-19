import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { User } from '@/api/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  demoLogin: (role: 'ADMIN' | 'AGENT' | 'USER') => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const data = await api.get<{ user: User }>('/auth/me');
        return data.user;
      } catch (error) {
        if ((error as { status?: number }).status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    };
    window.addEventListener('shiwei:unauthorized', onUnauthorized);
    return () => window.removeEventListener('shiwei:unauthorized', onUnauthorized);
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: User }>('/auth/login', { email, password });
    queryClient.setQueryData(['me'], data.user);
    return data.user;
  }, [queryClient]);

  const demoLogin = useCallback(async (role: 'ADMIN' | 'AGENT' | 'USER') => {
    const data = await api.post<{ user: User }>('/auth/demo-login', { role });
    queryClient.setQueryData(['me'], data.user);
    return data.user;
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.setQueryData(['me'], null);
      queryClient.clear();
    }
  }, [queryClient]);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const value = useMemo<AuthContextValue>(() => ({
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    login,
    demoLogin,
    logout,
    refresh,
  }), [meQuery.data, meQuery.isLoading, login, demoLogin, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
