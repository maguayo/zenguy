import type { AppLockThreshold } from "@/contexts/AppLockContext";
import type { SelectOption } from "@/ui";

const EAS_CHANNEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/u;
const UPDATE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const lockAfterOptions: SelectOption<AppLockThreshold>[] = [
  { label: "Immediately", value: "immediate" },
  { label: "1 minute", value: "1m" },
  { label: "5 minutes", value: "5m" },
];

export const appLockDescription =
  "Ask for Face ID or Touch ID when Zenguy returns to the foreground.";

export const appLockUnavailableHint =
  "Face ID or Touch ID isn't set up on this device. Enrol it in iOS Settings to lock Zenguy.";

export const sessionStorageNote =
  "Your sign-in session is kept in the iOS Keychain on this device only. Signing out revokes it on the server.";

export const appLockFailedMessage = "Couldn't verify it's you.";

export function userInitial(user: { email: string; name: string } | null): string {
  return (user?.name.slice(0, 1) || user?.email.slice(0, 1) || "U").toUpperCase();
}

export function appVersionLabel(
  version: string | undefined,
  buildNumber: string | undefined,
): string {
  if (!version) return "Zenguy";
  return buildNumber ? `Zenguy ${version} (${buildNumber})` : `Zenguy ${version}`;
}

/** Compact, display-only EAS metadata; malformed native values stay hidden. */
export function appUpdateTraceLabel(
  channel: string | null | undefined,
  updateId: string | null | undefined,
): string | null {
  const parts: string[] = [];
  const normalizedChannel = channel?.trim();
  if (normalizedChannel && EAS_CHANNEL_PATTERN.test(normalizedChannel)) {
    parts.push(`Channel ${normalizedChannel}`);
  }

  const normalizedUpdateId = updateId?.trim().toLowerCase();
  if (normalizedUpdateId && UPDATE_ID_PATTERN.test(normalizedUpdateId)) {
    parts.push(`Update ${normalizedUpdateId.slice(0, 8)}\u2026`);
  }
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}
