const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]+\]$/u;
// Only in-app destinations a notification may open: workspace screens by id.
const PUSH_PATH =
  /^\/(w\/[A-Za-z0-9_-]{1,64}\/(?:overview|incidents|alerts|tests|uptime|runs|notifications)(?:\/[A-Za-z0-9_-]{1,64})?)\/?$/u;

export type PushPermission = "denied" | "granted" | "unavailable" | "undetermined";
export type PushUnavailableReason = "not-configured" | "simulator" | null;

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && EXPO_PUSH_TOKEN.test(token);
}

/**
 * Turns the `data.url` carried by a Zenguy push notification into an in-app
 * path. Only the verified production Universal Link origin is accepted, so a
 * crafted payload can never steer the app elsewhere or rely on a claimable
 * custom URL scheme.
 */
export function pushLinkToPath(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.origin !== "https://app.zenguy.com" || parsed.search || parsed.hash) {
      return null;
    }
    const match = PUSH_PATH.exec(parsed.pathname);
    return match?.[1] ? `/${match[1]}` : null;
  } catch {
    return null;
  }
}

export function notificationPath(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  return pushLinkToPath((data as { url?: unknown }).url);
}

export function resolvePermission(input: {
  canAskAgain: boolean;
  isDevice: boolean;
  projectId: string | null;
  status: "denied" | "granted" | "undetermined";
}): { permission: PushPermission; reason: PushUnavailableReason } {
  if (!input.isDevice) return { permission: "unavailable", reason: "simulator" };
  if (!input.projectId) return { permission: "unavailable", reason: "not-configured" };
  if (input.status === "granted") return { permission: "granted", reason: null };
  if (input.status === "denied" && !input.canAskAgain) return { permission: "denied", reason: null };
  return { permission: "undetermined", reason: null };
}

export function unavailableMessage(reason: PushUnavailableReason): string {
  return reason === "simulator"
    ? "Push notifications aren't available in the iOS simulator."
    : "Push notifications aren't configured for this build yet.";
}

export const pushPromptTitle = "Get alerts on this iPhone";
export const pushPromptBody =
  "Zenguy notifies you when a test fails or a site goes down — and when it recovers.";
export const pushDeniedMessage =
  "Notifications are turned off for Zenguy in iOS Settings. Turn them on to get alerts on this iPhone.";
