import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { api, getErrorMessage, setSessionExpiredHandler } from './api';
import * as storage from './storage';
import type { User } from './types';

type SessionValue = {
  user: User | null;
  loading: boolean;
  error: string;
  setAuthenticated: (token: string, user: User) => Promise<void>;
  clearSession: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

function normalizeUser(value: Record<string, unknown>): User {
  return {
    ...value,
    username: String(value.username || ''),
    name: String(value.name || value.username || ''),
    role: value.role === 'admin' ? 'admin' : 'staff',
    department: String(value.department || ''),
    program: value.program === 'PG' || value.program === 'All' ? value.program : 'UG',
    year: String(value.year || ''),
    classId: typeof value.classId === 'string' ? value.classId : '',
  } as User;
}

export function SessionProvider({ children }: React.PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshUser = useCallback(async () => {
    const response = await api.get('/auth/me');
    const data = response.data as { user?: Record<string, unknown> };
    if (!data.user) throw new Error('The server did not return the authenticated user.');
    const nextUser = normalizeUser(data.user);
    await storage.setItemAsync('attendance.user', JSON.stringify(nextUser));
    setUser(nextUser);
    setError('');
  }, []);

  const setAuthenticated = useCallback(async (token: string, nextUser: User) => {
    try {
      await storage.setItemAsync('attendance.jwt', token);
      await storage.setItemAsync('attendance.user', JSON.stringify(nextUser));
    } catch (reason) {
      await storage.deleteItemAsync('attendance.jwt');
      await storage.deleteItemAsync('attendance.user');
      throw reason;
    }
    setUser(nextUser);
    setError('');
  }, []);

  const clearSession = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      await storage.deleteItemAsync('attendance.jwt');
      await storage.deleteItemAsync('attendance.user');
      setUser(null);
      setError('');
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setError('Your session expired. Sign in again.');
    });
    return () => setSessionExpiredHandler(undefined);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await storage.getItemAsync('attendance.jwt');
        if (token) {
          const cachedUser = await storage.getItemAsync('attendance.user');
          if (cachedUser) {
            try {
              const parsed = JSON.parse(cachedUser) as Record<string, unknown>;
              if (parsed.role === 'admin' || parsed.role === 'staff') setUser(normalizeUser(parsed));
            } catch {
              await storage.deleteItemAsync('attendance.user');
            }
          }
          await refreshUser();
        } else {
          await storage.deleteItemAsync('attendance.user');
        }
      } catch (reason) {
        if (active) {
          if (axios.isAxiosError(reason) && [401, 403].includes(reason.response?.status || 0)) {
            await storage.deleteItemAsync('attendance.jwt');
            await storage.deleteItemAsync('attendance.user');
            setUser(null);
          }
          setError(getErrorMessage(reason));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshUser]);

  const value = useMemo(() => ({
    user, loading, error, setAuthenticated, clearSession, refreshUser,
  }), [user, loading, error, setAuthenticated, clearSession, refreshUser]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}
