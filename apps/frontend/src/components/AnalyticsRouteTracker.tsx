import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { matchPath, useLocation } from "react-router-dom";

import { listWorkspaces } from "../api/workspaces";
import { useAuth } from "../contexts/AuthContext";
import { analyticsRoutePatternFor } from "../lib/activity/route-events";
import {
  accountAgeBucketFor,
  analyticsUserIdFor,
  setAnalyticsUserContext,
  trackAnalyticsPageViewWithContext,
  updateAnalyticsPageContext,
  workspaceCountBucketFor,
  type AnalyticsAuthState,
  type AnalyticsPageViewContext,
} from "../lib/analytics/ga4";
import { useCookieConsent } from "./CookieConsent";

interface AnalyticsRouteSyncApi {
  trackPageView: (
    routePattern: string,
    context: AnalyticsPageViewContext,
  ) => boolean;
  updatePageContext: (
    routePattern: string,
    context: AnalyticsPageViewContext,
  ) => boolean;
}

/**
 * The concrete pathname stays only in memory: it distinguishes two resources
 * that share a sanitized route template, while query-only navigation is not a
 * new view. Context refreshes still reach GA without emitting `page_view`.
 */
export function syncAnalyticsRoute(
  lastTrackedPathname: string | null,
  pathname: string,
  routePattern: string,
  context: AnalyticsPageViewContext,
  api: AnalyticsRouteSyncApi,
): string | null {
  if (lastTrackedPathname === pathname) {
    api.updatePageContext(routePattern, context);
    return lastTrackedPathname;
  }
  return api.trackPageView(routePattern, context)
    ? pathname
    : lastTrackedPathname;
}

/**
 * Emits one sanitized page view per concrete SPA pathname. Authenticated views
 * wait for the cached workspace list so role and subscription cuts are correct
 * on their first event rather than being backfilled later.
 */
export function AnalyticsRouteTracker() {
  const { analytics } = useCookieConsent();
  const { status, user } = useAuth();
  const location = useLocation();
  const lastTrackedPathname = useRef<string | null>(null);
  const verified = status === "signedIn" && user?.emailVerified === true;
  const workspaces = useQuery({
    enabled: analytics && verified,
    queryFn: listWorkspaces,
    queryKey: ["workspaces"],
  });

  useEffect(() => {
    if (!analytics) return undefined;
    const routePattern = analyticsRoutePatternFor(location.pathname);
    if (routePattern === null) return undefined;
    if (verified && workspaces.isPending) return undefined;

    let active = true;
    void (async () => {
      const authState: AnalyticsAuthState =
        status !== "signedIn"
          ? "signed_out"
          : verified
            ? "signed_in_verified"
            : "signed_in_unverified";

      if (status === "signedIn" && user !== null) {
        const [userId, accountAgeBucket] = await Promise.all([
          analyticsUserIdFor(user.id),
          Promise.resolve(accountAgeBucketFor(user.createdAt)),
        ]);
        if (!active) return;
        const workspaceCountBucket =
          verified && workspaces.data
            ? workspaceCountBucketFor(workspaces.data.length)
            : "unknown";
        setAnalyticsUserContext(
          userId
            ? {
                accountAgeBucket: accountAgeBucket ?? "unknown",
                userId,
                workspaceCountBucket: workspaceCountBucket ?? "unknown",
              }
            : null,
        );
      } else {
        // Clear a previous signed-in identity before the public auth view.
        setAnalyticsUserContext(null);
      }

      const workspaceId = matchPath(
        { end: false, path: "/w/:wsId/*" },
        location.pathname,
      )?.params.wsId;
      const workspace = workspaces.data?.find(
        (candidate) => candidate.id === workspaceId,
      );
      const pageContext: AnalyticsPageViewContext = {
        authState,
        ...(workspace
          ? {
              subscriptionStatus: workspace.subscriptionStatus,
              workspaceRole: workspace.role,
            }
          : {}),
      };
      lastTrackedPathname.current = syncAnalyticsRoute(
        lastTrackedPathname.current,
        location.pathname,
        routePattern,
        pageContext,
        {
          trackPageView: trackAnalyticsPageViewWithContext,
          updatePageContext: updateAnalyticsPageContext,
        },
      );
    })();

    return () => {
      active = false;
    };
  }, [
    analytics,
    location.pathname,
    status,
    user,
    verified,
    workspaces.data,
    workspaces.isPending,
  ]);

  return null;
}
