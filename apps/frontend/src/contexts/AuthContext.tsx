import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { login, logout, me, refresh, type AuthSession } from "../api/auth";
import type { User } from "../api/types";
import { Spinner } from "../components/ui/Spinner";
import { authEvents } from "../lib/api";
import { clearToken } from "../lib/auth-token";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  /** Adopts a session obtained outside the password form (sign-up, email verification). */
  adoptSession: (session: AuthSession) => void;
  refreshUser: () => Promise<User>;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  status: AuthStatus;
  user: User | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);

  const becomeSignedOut = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    let active = true;
    void refresh()
      .then((session) => {
        if (!active) return;
        setUser(session.user);
        setStatus("signedIn");
      })
      .catch(() => {
        if (active) becomeSignedOut();
      });
    return () => {
      active = false;
    };
  }, [becomeSignedOut]);

  useEffect(
    () =>
      authEvents.onSignedOut(() => {
        becomeSignedOut();
        navigate("/signin", { replace: true });
      }),
    [becomeSignedOut, navigate],
  );

  const adoptSession = useCallback((session: AuthSession) => {
    setUser(session.user);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await login(email, password);
      adoptSession(session);
      return session.user;
    },
    [adoptSession],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      becomeSignedOut();
      navigate("/signin", { replace: true });
    }
  }, [becomeSignedOut, navigate]);

  const refreshUser = useCallback(async () => {
    const nextUser = await me();
    setUser(nextUser);
    setStatus("signedIn");
    return nextUser;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ adoptSession, refreshUser, signIn, signOut, status, user }),
    [adoptSession, refreshUser, signIn, signOut, status, user],
  );

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading Zenguy" size={6} />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
