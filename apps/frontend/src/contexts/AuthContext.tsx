import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { activateSession, login, logout, me, refresh, type AuthSession } from "../api/auth";
import type { User } from "../api/types";
import { Spinner } from "../components/ui/Spinner";
import { authEvents, supersedeSession } from "../lib/api";
import { clearPrincipalCache, setQueryPrincipal } from "../lib/query-client";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  /** Adopts a session obtained outside the password form (sign-up, email verification). */
  adoptSession: (session: AuthSession) => Promise<void>;
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
  const principalRef = useRef<string | null>(null);

  const becomeSignedOut = useCallback(async () => {
    supersedeSession();
    await clearPrincipalCache();
    principalRef.current = null;
    setUser(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    let active = true;
    void refresh()
      .then((session) => {
        if (!active) return;
        setQueryPrincipal(session.user.id);
        principalRef.current = session.user.id;
        setUser(session.user);
        setStatus("signedIn");
      })
      .catch(() => {
        if (active) void becomeSignedOut();
      });
    return () => {
      active = false;
    };
  }, [becomeSignedOut]);

  useEffect(
    () =>
      authEvents.onSignedOut(() => {
        void becomeSignedOut().then(() => navigate("/signin", { replace: true }));
      }),
    [becomeSignedOut, navigate],
  );

  const adoptSession = useCallback(async (session: AuthSession) => {
    if (principalRef.current !== null && principalRef.current !== session.user.id) {
      supersedeSession();
      await clearPrincipalCache(null);
      principalRef.current = null;
      setUser(null);
      setStatus("signedOut");
    }
    activateSession(session);
    setQueryPrincipal(session.user.id);
    principalRef.current = session.user.id;
    setUser(session.user);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await login(email, password);
      await adoptSession(session);
      return session.user;
    },
    [adoptSession],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      await becomeSignedOut();
      navigate("/signin", { replace: true });
    }
  }, [becomeSignedOut, navigate]);

  const refreshUser = useCallback(async () => {
    const nextUser = await me();
    if (principalRef.current !== null && principalRef.current !== nextUser.id) {
      await becomeSignedOut();
      throw new Error("Authenticated principal changed unexpectedly");
    }
    setQueryPrincipal(nextUser.id);
    principalRef.current = nextUser.id;
    setUser(nextUser);
    setStatus("signedIn");
    return nextUser;
  }, [becomeSignedOut]);

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

  // A principal change remounts the authenticated subtree, closing SSE and
  // other non-Query subscriptions that may still carry A data.
  return (
    <AuthContext.Provider key={user?.id ?? status} value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
