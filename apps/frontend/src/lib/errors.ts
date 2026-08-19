import { ApiError } from "./api";

export const unavailableItemMessage =
  "This item is no longer available (data is kept for 30 days).";

export function apiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Something went wrong";
}

export function isUnavailableItem(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 410);
}

export function itemQueryErrorMessage(error: unknown): string | undefined {
  return isUnavailableItem(error) ? unavailableItemMessage : undefined;
}
