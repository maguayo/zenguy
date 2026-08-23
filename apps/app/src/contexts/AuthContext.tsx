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

import {
  activateSession,
  login,
  logout,
  me,
  refresh,
  retryPendingLogout,
  type AuthSession,
} from "@/api/auth";
import type { User } from "@/api/types";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import {
  authEvents,
  clearSession,
  hasStoredSession,
  isAuthRejection,
  isTerminalLogoutPending,
  supersedeSession,
} from "@/lib/api";
import { clearPrincipalCache, setQueryPrincipal } from "@/lib/query-client";
import { secureStorage, storageKeys } from "@/lib/secure-storage";
import { runBeforeSignOut } from "@/lib/session-hooks";

/**
 * - loading: the stored session is being checked
 * - signedIn / signedOut: definitive
 * - unavailable: a session exists but the API could not be reached
 */
export type AuthStatus = "loading" | "signedIn" | "signedOut" | "unavailable";

export interface AuthContextValue {
  /** Tears down the old principal, persists the replacement, then adopts it. */
  adoptSession: (session: AuthSession) => Promise<void>;
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
  const principalRef = useRef<string | null>(null);

  const clearPrincipalData = useCallback(async (nextPrincipalId: string | null = null) => {
    await clearPrincipalCache(nextPrincipalId);
    await Promise.allSettled([
      secureStorage.deleteItem(storageKeys.lastWorkspace),
      secureStorage.deleteItem(storageKeys.pushDevice),
      Image.clearDiskCache(),
      Notifications.dismissAllNotificationsAsync(),
      Notifications.setBadgeCountAsync(0),
    ]);
  }, []);

  const becomeSignedOut = useCallback(async () => {
    supersedeSession();
    await clearPrincipalData();
    principalRef.current = null;
    setUser(null);
    setStatus("signedOut");
  }, [clearPrincipalData]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (await isTerminalLogoutPending()) {
        await retryPendingLogout().catch(() => undefined);
        if (active) await becomeSignedOut();
        return;
      }
      if (!(await hasStoredSession())) {
        if (active) await becomeSignedOut();
        return;
      }
      try {
        const session = await refresh();
        if (!active) return;
        setQueryPrincipal(session.user.id);
        principalRef.current = session.user.id;
        setUser(session.user);
        setStatus("signedIn");
      } catch (error) {
        if (!active) return;
        if (isAuthRejection(error)) {
          await clearSession();
          await becomeSignedOut();
        } else {
          setStatus("unavailable");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, becomeSignedOut]);

  useEffect(
    () => authEvents.onSignedOut(() => void becomeSignedOut()),
    [becomeSignedOut],
  );

  const adoptSession = useCallback(
    async (session: AuthSession) => {
      if (principalRef.current !== null && principalRef.current !== session.user.id) {
        // Push must be detached while the old access token is still active.
        await runBeforeSignOut({ required: true });
        supersedeSession();
        await clearPrincipalData(null);
        principalRef.current = null;
        setUser(null);
        setStatus("signedOut");
      }
      await activateSession(session);
      setQueryPrincipal(session.user.id);
      principalRef.current = session.user.id;
      setUser(session.user);
      setStatus("signedIn");
    },
    [clearPrincipalData],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await login(email, password);
      await adoptSession(session);
      return session.user;
    },
    [adoptSession],
  );

  const signOut = useCallback(async () => {
    // Device-level cleanup (push unregistration) needs the session to still be valid.
    await runBeforeSignOut();
    try {
      await logout();
    } finally {
      await becomeSignedOut();
    }
  }, [becomeSignedOut]);

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

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ adoptSession, refreshUser, retry, signIn, signOut, status, user }),
    [adoptSession, refreshUser, retry, signIn, signOut, status, user],
  );

  // Remount every descendant on A→B so native listeners and view-local state
  // cannot survive alongside the new principal.
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
