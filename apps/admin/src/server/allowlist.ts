export function parseAdminEmails(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export function isAdminEmail(raw: string, email: string): boolean {
  return parseAdminEmails(raw).has(email.trim().toLowerCase());
}
