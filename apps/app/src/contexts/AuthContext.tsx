import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { login, logout, me, refresh } from "@/api/auth";
import type { User } from "@/api/types";
import { authEvents, clearSession, hasStoredSession, isAuthRejection } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { runBeforeSignOut } from "@/lib/session-hooks";

/**
 * - loading: the stored session is being checked
 * - signedIn / signedOut: definitive
 * - unavailable: a session exists but the API could not be reached
 */
export type AuthStatus = "loading" | "signedIn" | "signedOut" | "unavailable";

export interface AuthContextValue {
  refreshUser: () => Promise<User>;
  retry: () => void;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  status: AuthStatus;
  user: User | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [attempt, setAttempt] = useState(0);

  const becomeSignedOut = useCallback(() => {
    queryClient.clear();
    setUser(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!(await hasStoredSession())) {
        if (active) becomeSignedOut();
        return;
      }
      try {
        const session = await refresh();
        if (!active) return;
        setUser(session.user);
        setStatus("signedIn");
      } catch (error) {
        if (!active) return;
        if (isAuthRejection(error)) {
          await clearSession();
          becomeSignedOut();
        } else {
          setStatus("unavailable");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, becomeSignedOut]);

  useEffect(() => authEvents.onSignedOut(becomeSignedOut), [becomeSignedOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await login(email, password);
    setUser(session.user);
    setStatus("signedIn");
    return session.user;
  }, []);

  const signOut = useCallback(async () => {
    // Device-level cleanup (push unregistration) needs the session to still be valid.
    await runBeforeSignOut();
    try {
      await logout();
    } finally {
      becomeSignedOut();
    }
  }, [becomeSignedOut]);

  const refreshUser = useCallback(async () => {
    const nextUser = await me();
    setUser(nextUser);
    setStatus("signedIn");
    return nextUser;
  }, []);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ refreshUser, retry, signIn, signOut, status, user }),
    [refreshUser, retry, signIn, signOut, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
