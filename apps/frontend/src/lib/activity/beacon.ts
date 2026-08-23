import { getToken } from "../auth-token";
import type { ClientEvent } from "./route-events";

// Same origin rule as src/lib/api.ts: an explicit API origin in deployed
// environments, same-origin relative URLs (Vite proxy) in development.
const API_ORIGIN = ((import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "").replace(
  /\/+$/,
  "",
);

export const ACTIVITY_EVENTS_PATH = "/api/me/events";

/** Pure request builder, so the headers and body can be tested without fetch. */
export function beaconRequest(
  events: ClientEvent[],
  accessToken: string | null,
  origin: string = API_ORIGIN,
): { url: string; init: RequestInit } {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return {
    url: `${origin}${ACTIVITY_EVENTS_PATH}`,
    init: {
      body: JSON.stringify({ events }),
      credentials: "include",
      headers,
      keepalive: true,
      method: "POST",
    },
  };
}

/**
 * Best-effort delivery of an activity batch: keeps the request alive across
 * navigations, never retries, never throws and never touches the session
 * (a 401 here must not sign the user out).
 */
export async function sendActivityBeacon(events: ClientEvent[]): Promise<void> {
  const { url, init } = beaconRequest(events, getToken().accessToken);
  try {
    await fetch(url, init);
  } catch {
    // Telemetry is disposable.
  }
}
