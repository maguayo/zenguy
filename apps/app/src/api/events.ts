import type { ClientEvent } from "../lib/activity/screen-events";
import { apiPost } from "../lib/api";

/**
 * Best effort: visits are disposable and a failure must never surface in the
 * UI. This also swallows SessionSupersededError during sign-out and
 * principal switches; there is no retry.
 */
export async function sendActivityEvents(events: ClientEvent[]): Promise<void> {
  try {
    await apiPost("/api/me/events", { events });
  } catch {
    // Dropped on purpose.
  }
}
