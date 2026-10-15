"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, LOGOUT_EVENT, tokens, type User } from "@/lib/api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const loadUser = useCallback(async () => {
    if (!tokens.access && !tokens.refresh) {
      setStatus("anonymous");
      return;
    }
    try {
      setUser(await api.me());
      setStatus("authenticated");
    } catch {
      tokens.clear();
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  // The API client fires this when a refresh token is rejected (expired/revoked).
  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setStatus("anonymous");
      router.replace("/login");
    };
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(LOGOUT_EVENT, onLogout);
  }, [router]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.login(email, password);
      await loadUser();
    },
    [loadUser],
  );

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      await api.register(email, password, fullName);
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    setStatus("anonymous");
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, status, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
