export type PushPlatform = "ios" | "android";

export interface PushDevice {
  id: string;
  userId: string;
  /** Expo push token, e.g. `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. */
  token: string;
  platform: PushPlatform;
  deviceName: string | null;
  appVersion: string | null;
  enabled: boolean;
  /** Why the device was switched off automatically (e.g. DeviceNotRegistered). */
  disabledReason: string | null;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PUSH_CHANNEL_NAME = "Mobile push";
export const PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/u;

export function isExpoPushToken(value: string): boolean {
  return PUSH_TOKEN_PATTERN.test(value);
}

/** The last characters of a token, enough to recognise a device in the UI. */
export function pushTokenSuffix(token: string): string {
  return token.replace(/\]$/u, "").slice(-6);
}

export function redactPushTokens(text: string): string {
  return text.replace(/Expo(?:nent)?PushToken\[[^\]]*\]/gu, "[redacted-token]");
}
