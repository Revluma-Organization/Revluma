import { createContext, type ReactNode } from "react";

interface MockUser {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  tenant_id: string;
  email_verified: boolean;
  onboarding_status: string;
  membership_tier: string;
  account_status: string;
  last_login_at: string | null;
}

interface AuthContextValue {
  user: MockUser;
  logout: () => void;
}

const MOCK_USER: MockUser = {
  id: "mock-user-001",
  email: "alex@mystore.com",
  full_name: "Alex Johnson",
  display_name: "Alex",
  avatar_url: null,
  role: "admin",
  tenant_id: "tenant-001",
  email_verified: true,
  onboarding_status: "completed",
  membership_tier: "pro",
  account_status: "active",
  last_login_at: new Date().toISOString(),
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const logout = () => {
    window.location.href = "/auth/loginIn.html";
  };

  return (
    <AuthContext.Provider value={{ user: MOCK_USER, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return { user: MOCK_USER, logout: () => { window.location.href = "/auth/loginIn.html"; } };
}
