import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client.ts";
import type { CurrentUser, OrgPrefs } from "../api/types.ts";
import { isManagerial, canCreateUsers } from "@smart-crm/shared";
import { setFormatPrefs } from "../lib/format.ts";

interface RegisterFields {
  companyName: string;
  fullName: string;
  email: string;
  password: string;
  currency: string;
  dateFormat: string;
}

interface AuthState {
  user: CurrentUser | null;
  org: OrgPrefs | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fields: RegisterFields) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isManager: boolean;
  isSuperAdmin: boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [org, setOrg] = useState<OrgPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  function applyOrg(next: OrgPrefs | null) {
    setOrg(next);
    setFormatPrefs(next);
  }

  async function refresh() {
    try {
      const { user, org } = await api.get<{ user: CurrentUser; org: OrgPrefs | null }>("/api/auth/me");
      setUser(user);
      applyOrg(org);
    } catch {
      setUser(null);
      applyOrg(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const { user, org } = await api.post<{ user: CurrentUser; org: OrgPrefs | null }>("/api/auth/login", { email, password });
    setUser(user);
    applyOrg(org);
  }

  async function register(fields: RegisterFields) {
    const { user, org } = await api.post<{ user: CurrentUser; org: OrgPrefs | null }>("/api/auth/register", {
      company_name: fields.companyName,
      full_name: fields.fullName,
      email: fields.email,
      password: fields.password,
      currency: fields.currency,
      date_format: fields.dateFormat,
    });
    setUser(user);
    applyOrg(org);
  }

  async function logout() {
    // Always clear local session, even if the network call fails — sign-out must never get stuck.
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore — cookie may already be gone */
    }
    setUser(null);
    applyOrg(null);
  }

  return (
    <AuthCtx.Provider
      value={{
        user,
        org,
        loading,
        login,
        register,
        logout,
        refresh,
        isManager: user ? isManagerial(user.role) : false,
        isSuperAdmin: user ? canCreateUsers(user.role) : false,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
