export type AdminUserIds = ReadonlySet<string>;

// API user ids are the lowercase, canonical form emitted by newId("usr").
// The first ULID character is restricted to 0..7 so the 26-character payload
// cannot overflow ULID's 128-bit range.
const REAL_USER_ID_PATTERN = /^usr_[0-7][0-9a-hjkmnp-tv-z]{25}$/u;

export function isRealUserId(value: string): boolean {
  return !value.startsWith("usr_seed_") && REAL_USER_ID_PATTERN.test(value);
}

export function parseAdminUserIds(raw: unknown): AdminUserIds {
  if (typeof raw !== "string") {
    throw new Error("ADMIN_USER_IDS must contain only canonical usr_<ULID> ids");
  }
  const entries = raw.split(",").map((entry) => entry.trim());
  if (
    entries.length === 0 ||
    entries.some((entry) => !isRealUserId(entry)) ||
    new Set(entries).size !== entries.length
  ) {
    throw new Error("ADMIN_USER_IDS must contain only unique canonical usr_<ULID> ids");
  }
  return new Set(entries);
}

export function isAdminUserId(adminUserIds: AdminUserIds, userId: string): boolean {
  return isRealUserId(userId) && adminUserIds.has(userId);
}
