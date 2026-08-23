import Constants from "expo-constants";
import { useGlobalSearchParams, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { sendActivityEvents } from "@/api/events";
import { useAuth } from "@/contexts/AuthContext";
import { createActivityQueue, type ActivityQueue } from "@/lib/activity/queue";
import { appOpenedEvent, visitEventFor, type ClientEvent } from "@/lib/activity/screen-events";
import { authEvents } from "@/lib/api";
import { onBeforeSignOut } from "@/lib/session-hooks";

const meta = { appVersion: Constants.expoConfig?.version ?? null };

// `app.opened` means a cold start or a return from the background; a sign-out
// followed by a sign-in in the same process is neither, so the synchronous
// report happens once per process.
let coldStartReported = false;

/** Test hook: forget that the cold start was already reported. */
export function resetActivityTrackerForTests(): void {
  coldStartReported = false;
}

interface Tracker {
  queue: ActivityQueue;
  /** Resolves once every batch handed to the transport has been answered. */
  settle: () => Promise<void>;
}

/** The activity queue plus a handle on its in-flight deliveries, so sign-out can wait for them. */
function createTracker(): Tracker {
  const inFlight = new Set<Promise<void>>();
  const queue = createActivityQueue({
    send(events) {
      const delivery = sendActivityEvents(events).finally(() => inFlight.delete(delivery));
      inFlight.add(delivery);
      return delivery;
    },
  });
  return {
    queue,
    settle: async () => {
      await Promise.allSettled(inFlight);
    },
  };
}

/**
 * Reports screen visits and app opens for the signed-in user, batched through
 * the activity queue. Renders nothing. It sits next to <UpdateGate /> in the
 * root layout, so it keeps observing AppState while the app is locked: opening
 * the app is activity even when the content is concealed.
 */
export function ActivityTracker() {
  const { status, user } = useAuth();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const [tracker] = useState(createTracker);
  // The API only accepts events from verified accounts, so nothing is queued before that.
  const tracking = status === "signedIn" && user?.emailVerified === true;

  useEffect(() => {
    const { queue, settle } = tracker;
    if (!tracking) {
      queue.clear();
      return;
    }
    // Cold start, or a session confirmed after launch: the app is open right now.
    if (!coldStartReported && AppState.currentState === "active") {
      coldStartReported = true;
      queue.push(appOpenedEvent(meta));
    }
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") queue.push(appOpenedEvent(meta));
      if (state === "background") queue.flush();
    });
    // The session is still valid here: deliver what is pending, wait for it
    // (sign-out aborts in-flight requests), then forget this principal's history.
    const unsubscribeBeforeSignOut = onBeforeSignOut(async () => {
      queue.flush();
      await settle();
      queue.clear();
    });
    // A rejected refresh token: there is nothing left to send with.
    const unsubscribeSignedOut = authEvents.onSignedOut(() => queue.clear());
    return () => {
      subscription.remove();
      unsubscribeBeforeSignOut();
      unsubscribeSignedOut();
    };
  }, [tracker, tracking]);

  // Keyed on the visit's content rather than on the objects the router hands
  // back: a re-render, or a query-only change on the same screen, is not a visit.
  const visitKey = JSON.stringify(visitEventFor(segments, params, meta));
  useEffect(() => {
    if (!tracking) return;
    const visit = JSON.parse(visitKey) as ClientEvent | null;
    if (visit !== null) tracker.queue.push(visit);
  }, [tracker, tracking, visitKey]);

  return null;
}
