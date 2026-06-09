import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '@/types';
import { api, setUnauthorizedHandler } from '@/utils/api';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('sm_current_user');
    localStorage.removeItem('sm_auth_token');
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('sm_current_user');
    const token = localStorage.getItem('sm_auth_token');
    if (saved && token) {
      try {
        setUser(JSON.parse(saved));
        api.me().catch(() => logout());
      } catch { /* ignore */ }
    }
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await api.login(email.trim(), password) as any;
      const loggedInUser = response?.user || (response?.id ? response : null);
      if (loggedInUser) {
        localStorage.setItem('sm_auth_token', response?.token || `sm-local-${loggedInUser.id}`);
        localStorage.setItem('sm_current_user', JSON.stringify(loggedInUser));
        setUser(loggedInUser);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
