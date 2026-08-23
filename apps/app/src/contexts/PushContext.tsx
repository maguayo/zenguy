import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { Linking } from "react-native";

import { registerPushDevice, removePushDevice, updatePushDevice, type PushDevice } from "@/api/push";
import { useAuth } from "@/contexts/AuthContext";
import {
  isExpoPushToken,
  notificationPath,
  resolvePermission,
  type PushPermission,
  type PushUnavailableReason,
} from "@/lib/push";
import { secureStorage, storageKeys } from "@/lib/secure-storage";
import { onBeforeSignOut } from "@/lib/session-hooks";

// Alerts arriving while the app is open still show as banners.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushContextValue {
  device: PushDevice | null;
  dismissPrompt: () => void;
  openSettings: () => void;
  permission: PushPermission;
  promptDismissed: boolean;
  reason: PushUnavailableReason;
  registerError: string | null;
  registering: boolean;
  /** Asks iOS for permission and registers the device; resolves to the granted state. */
  requestPermission: () => Promise<boolean>;
  retryRegistration: () => Promise<void>;
  setDeviceEnabled: (enabled: boolean) => Promise<void>;
}

const PushContext = createContext<PushContextValue | null>(null);

function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId;
  return fromExtra ?? Constants.easConfig?.projectId ?? null;
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const [permission, setPermission] = useState<PushPermission>("undetermined");
  const [reason, setReason] = useState<PushUnavailableReason>(null);
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const deviceRef = useRef<PushDevice | null>(null);
  const eligible = status === "signedIn" && Boolean(user?.emailVerified);
  const principalId = eligible ? (user?.id ?? null) : null;

  const register = useCallback(async () => {
    const projectId = easProjectId();
    if (!Device.isDevice || !projectId) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (!isExpoPushToken(token)) throw new Error("Unexpected push token format");
      const registered = await registerPushDevice({
        appVersion: Constants.expoConfig?.version ?? undefined,
        deviceName: Device.modelName ?? undefined,
        platform: "ios",
        token,
      });
      deviceRef.current = registered;
      setDevice(registered);
      await secureStorage.setItem(storageKeys.pushDevice, registered.id);
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : "Couldn't register this device.");
    } finally {
      setRegistering(false);
    }
  }, []);

  const readPermission = useCallback(async () => {
    const current = await Notifications.getPermissionsAsync();
    return resolvePermission({
      canAskAgain: current.canAskAgain,
      isDevice: Device.isDevice,
      projectId: easProjectId(),
      status: current.status,
    });
  }, []);

  const refreshPermission = useCallback(async (): Promise<PushPermission> => {
    const resolved = await readPermission();
    setPermission(resolved.permission);
    setReason(resolved.reason);
    return resolved.permission;
  }, [readPermission]);

  // On every start with a session (and when the token changes) re-register.
  useEffect(() => {
    if (!principalId) return undefined;
    let active = true;
    void readPermission().then((resolved) => {
      if (!active) return;
      setPermission(resolved.permission);
      setReason(resolved.reason);
      if (resolved.permission === "granted") void register();
    });
    const subscription = Notifications.addPushTokenListener(() => {
      if (active && deviceRef.current) void register();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [principalId, readPermission, register]);

  // Tapping a notification opens the incident it points to.
  useEffect(() => {
    const open = (data: unknown) => {
      const path = notificationPath(data);
      if (path) router.push(path);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data);
    });
    return () => subscription.remove();
  }, [router]);

  // Unregister before the session is revoked. A failed DELETE deliberately
  // keeps the id so an A→B adoption can fail closed instead of forgetting that
  // A is still associated with this device.
  const unregister = useCallback(async () => {
    const id = deviceRef.current?.id ?? (await secureStorage.getItem(storageKeys.pushDevice));
    if (id) await removePushDevice(id);
    await secureStorage.deleteItem(storageKeys.pushDevice);
    deviceRef.current = null;
    setDevice(null);
  }, []);

  // Register before descendant verification effects can adopt another
  // principal in the same commit.
  useLayoutEffect(() => onBeforeSignOut(unregister), [unregister]);

  // A rejected/revoked session cannot authenticate the DELETE anymore, but it
  // must still stop exposing the previous principal's device state locally.
  useEffect(() => {
    if (status !== "signedOut") return;
    deviceRef.current = null;
    void secureStorage.deleteItem(storageKeys.pushDevice);
  }, [status]);

  const requestPermission = useCallback(async () => {
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    const state = await refreshPermission();
    if (result.granted || state === "granted") {
      await register();
      return true;
    }
    return false;
  }, [refreshPermission, register]);

  const setDeviceEnabled = useCallback(async (enabled: boolean) => {
    const current = deviceRef.current;
    if (!current) return;
    const updated = await updatePushDevice(current.id, { enabled });
    deviceRef.current = updated;
    setDevice(updated);
  }, []);

  const value = useMemo<PushContextValue>(
    () => ({
      device: principalId ? device : null,
      dismissPrompt: () => setPromptDismissed(true),
      openSettings: () => void Linking.openSettings(),
      permission,
      promptDismissed,
      reason,
      registerError,
      registering,
      requestPermission,
      retryRegistration: register,
      setDeviceEnabled,
    }),
    [device, permission, principalId, promptDismissed, reason, register, registerError, registering, requestPermission, setDeviceEnabled],
  );

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): PushContextValue {
  const value = useContext(PushContext);
  if (!value) throw new Error("usePush must be used within PushProvider");
  return value;
}
