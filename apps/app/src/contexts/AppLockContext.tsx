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
import * as LocalAuthentication from "expo-local-authentication";
import { AppState, type AppStateStatus } from "react-native";

import { secureStorage, storageKeys } from "@/lib/secure-storage";

export type AppLockThreshold = "1m" | "5m" | "immediate";

export interface AppLockPreferences {
  enabled: boolean;
  threshold: AppLockThreshold;
}

export const thresholdMs: Record<AppLockThreshold, number> = {
  "1m": 60_000,
  "5m": 300_000,
  immediate: 0,
};

export const defaultPreferences: AppLockPreferences = { enabled: false, threshold: "1m" };

export function parsePreferences(raw: string | null): AppLockPreferences {
  if (!raw) return defaultPreferences;
  try {
    const parsed = JSON.parse(raw) as Partial<AppLockPreferences>;
    const threshold: AppLockThreshold =
      parsed.threshold === "immediate" || parsed.threshold === "5m" || parsed.threshold === "1m"
        ? parsed.threshold
        : defaultPreferences.threshold;
    return { enabled: parsed.enabled === true, threshold };
  } catch {
    return defaultPreferences;
  }
}

/** Whether returning to the foreground at `now` must require authentication. */
export function shouldLock(
  preferences: AppLockPreferences,
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (!preferences.enabled || backgroundedAt === null) return false;
  return now - backgroundedAt >= thresholdMs[preferences.threshold];
}

export interface AppLockContextValue {
  biometricsAvailable: boolean;
  locked: boolean;
  preferences: AppLockPreferences;
  ready: boolean;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  setThreshold: (threshold: AppLockThreshold) => Promise<void>;
  unlock: () => Promise<boolean>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

async function authenticate(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    promptMessage: "Unlock Zenguy",
  });
  if (result.success) return true;
  // Without a passcode the lock cannot be enforced at all; never strand the user.
  return !result.success && result.error === "passcode_not_set";
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AppLockPreferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  useEffect(() => {
    let active = true;
    void (async () => {
      const [raw, hardware, enrolled] = await Promise.all([
        secureStorage.getItem(storageKeys.appLock),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!active) return;
      const parsed = parsePreferences(raw);
      setPreferences(parsed);
      setBiometricsAvailable(hardware && enrolled);
      setLocked(parsed.enabled);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state === "active") {
        if (shouldLock(preferencesRef.current, backgroundedAt.current, Date.now())) {
          setLocked(true);
        }
        backgroundedAt.current = null;
      }
    });
    return () => subscription.remove();
  }, []);

  const persist = useCallback(async (next: AppLockPreferences) => {
    setPreferences(next);
    await secureStorage.setItem(storageKeys.appLock, JSON.stringify(next));
  }, []);

  const unlock = useCallback(async () => {
    const success = await authenticate();
    if (success) setLocked(false);
    return success;
  }, []);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      // Turning the lock on or off always proves presence first.
      if (!(await authenticate())) return false;
      await persist({ ...preferencesRef.current, enabled });
      return true;
    },
    [persist],
  );

  const setThreshold = useCallback(
    async (threshold: AppLockThreshold) => {
      await persist({ ...preferencesRef.current, threshold });
    },
    [persist],
  );

  const value = useMemo<AppLockContextValue>(
    () => ({ biometricsAvailable, locked, preferences, ready, setEnabled, setThreshold, unlock }),
    [biometricsAvailable, locked, preferences, ready, setEnabled, setThreshold, unlock],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockContextValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error("useAppLock must be used within AppLockProvider");
  return value;
}
