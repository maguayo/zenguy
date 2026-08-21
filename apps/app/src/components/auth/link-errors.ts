import { ApiError } from "@/lib/api";

/**
 * Email-link tokens (verification, password reset, invitations) that are
 * expired, already used or unknown: the API answers GONE (410); a vanished
 * resource (404) means the same thing to the user.
 */
export function isExpiredLink(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "GONE" || error.status === 410 || error.status === 404)
  );
}
