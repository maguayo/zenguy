import { validation } from "./errors";

export interface Cursor {
  createdAt: number;
  id: string;
}

function invalidCursor(): never {
  throw validation([{ field: "cursor", message: "Invalid cursor" }]);
}

export function encodeCursor(createdAt: number, id: string): string {
  return btoa(`${createdAt}:${id}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeCursor(encoded: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
      return invalidCursor();
    }
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const separator = decoded.indexOf(":");
    if (separator <= 0 || separator === decoded.length - 1) {
      return invalidCursor();
    }
    const createdAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || id.length === 0) {
      return invalidCursor();
    }
    return { createdAt, id };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "VALIDATION_ERROR"
    ) {
      throw error;
    }
    return invalidCursor();
  }
}
