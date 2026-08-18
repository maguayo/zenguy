import { validation } from "../../shared/errors";

export function workspaceName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw validation([
      { field: "name", message: "Must be between 1 and 80 characters" },
    ]);
  }
  return name;
}

export function workspaceTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    throw validation([{ field: "timezone", message: "Invalid timezone" }]);
  }
}
