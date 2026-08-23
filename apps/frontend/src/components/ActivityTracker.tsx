import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { useAuth, type AuthStatus } from "../contexts/AuthContext";
import { createActivityQueue, type ActivityQueue } from "../lib/activity/queue";
import { visitEventFor } from "../lib/activity/route-events";
import { sendActivityBeacon } from "../lib/activity/beacon";

/**
 * Only verified, signed-in sessions report activity: the API rejects batches
 * from unverified accounts, so the client never queues them.
 */
export function shouldTrack(
  status: AuthStatus,
  user: { emailVerified: boolean } | null,
): boolean {
  return status === "signedIn" && user !== null && user.emailVerified;
}

/** Reports page visits for the signed-in user. Renders nothing. */
export function ActivityTracker() {
  const { status, user } = useAuth();
  const location = useLocation();
  const queueRef = useRef<ActivityQueue | null>(null);
  const principalId = user?.id ?? null;

  if (queueRef.current === null) {
    queueRef.current = createActivityQueue({
      send: sendActivityBeacon,
    });
  }

  useEffect(() => {
    const queue = queueRef.current;
    if (queue === null) return;
    if (!shouldTrack(status, user)) {
      queue.clear();
      return;
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") queue.flush();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", queue.flush);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", queue.flush);
      // The tracker unmounts when RequireAuth redirects on sign-out: drop what
      // is pending so the previous user's visits never travel with the next token.
      queue.clear();
    };
  }, [status, principalId, user]);

  useEffect(() => {
    if (!shouldTrack(status, user)) return;
    const event = visitEventFor(location.pathname);
    if (event !== null) queueRef.current?.push(event);
  }, [status, principalId, user, location.pathname]);

  return null;
}
