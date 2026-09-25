import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, login as apiLogin, setAuthToken, setUnauthorizedHandler } from "../api/client";
import type { UserAccount } from "../api/types";

export interface AuthUser {
  token: string;
  id: string;
  username: string;
  role: string;
  fullName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: (reason?: "expired") => void;
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// sessionStorage, not localStorage: a shared courtroom terminal shouldn't stay
// signed in after the tab closes.
const STORAGE_KEY = "lexintel.session";

function readStored(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    return parsed?.token && parsed?.role ? parsed : null;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = readStored();
    if (stored) setAuthToken(stored.token);
    return stored;
  });
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const logout = useCallback((reason?: "expired") => {
    setAuthToken(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    setSessionExpired(reason === "expired");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout("expired"));
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Re-validate a restored session once (account may have been disabled or the password changed).
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setReady(true);
      return;
    }
    api
      .get<UserAccount>("/auth/me")
      .then((me) => {
        if (cancelled) return;
        const refreshed = { ...user, role: me.role, fullName: me.full_name, username: me.username, id: me.id };
        setUser(refreshed);
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
        } catch {
          /* storage blocked or full: the session still works, it just won't survive a reload */
        }
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 401) logout("expired");
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username.trim(), password);
    const authUser: AuthUser = {
      token: res.access_token,
      id: res.user_id,
      username: res.username,
      role: res.role,
      fullName: res.full_name,
    };
    setAuthToken(authUser.token);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch {
      /* ignore */
    }
    setSessionExpired(false);
    setUser(authUser);
    return authUser;
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, sessionExpired }}>{children}</AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
