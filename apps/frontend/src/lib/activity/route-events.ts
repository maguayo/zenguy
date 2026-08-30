import { matchPath } from "react-router-dom";

export type ClientEventType =
  | "web.page_viewed"
  | "browser_test.viewed"
  | "run.viewed"
  | "uptime_monitor.viewed"
  | "incident.viewed";

export interface ClientEvent {
  type: ClientEventType;
  workspaceId?: string;
  resourceId?: string;
  properties: { page: string };
}

interface RouteEvent {
  pattern: string;
  type: ClientEventType;
  resourceParam?: string;
}

interface AnalyticsRoute {
  pattern: string;
}

/**
 * Every authenticated route in App.tsx that renders a page. Public routes and
 * pure redirects (`/w/:wsId` index, legacy `/notifications`) are deliberately
 * absent, and so is `/verify-pending`: the API only accepts events from
 * verified accounts. Add a row when you add a page.
 *
 * Order matters for siblings: static segments (`tests/new`, `uptime/new`) are
 * listed before their `:param` counterparts so "new" is never read as an id.
 */
export const ROUTE_EVENTS: ReadonlyArray<RouteEvent> = [
  { pattern: "/complimentary", type: "web.page_viewed" },
  { pattern: "/onboarding/workspace", type: "web.page_viewed" },
  { pattern: "/w/:wsId/setup/billing", type: "web.page_viewed" },
  { pattern: "/w/:wsId/overview", type: "web.page_viewed" },
  { pattern: "/w/:wsId/tests", type: "web.page_viewed" },
  { pattern: "/w/:wsId/tests/new", type: "web.page_viewed" },
  { pattern: "/w/:wsId/tests/:testId", type: "browser_test.viewed", resourceParam: "testId" },
  { pattern: "/w/:wsId/tests/:testId/edit", type: "browser_test.viewed", resourceParam: "testId" },
  { pattern: "/w/:wsId/runs/:runId", type: "run.viewed", resourceParam: "runId" },
  { pattern: "/w/:wsId/uptime", type: "web.page_viewed" },
  { pattern: "/w/:wsId/uptime/new", type: "web.page_viewed" },
  { pattern: "/w/:wsId/uptime/:monitorId", type: "uptime_monitor.viewed", resourceParam: "monitorId" },
  { pattern: "/w/:wsId/uptime/:monitorId/edit", type: "uptime_monitor.viewed", resourceParam: "monitorId" },
  { pattern: "/w/:wsId/incidents", type: "web.page_viewed" },
  { pattern: "/w/:wsId/incidents/:incidentId", type: "incident.viewed", resourceParam: "incidentId" },
  { pattern: "/w/:wsId/status-pages", type: "web.page_viewed" },
  { pattern: "/w/:wsId/status-pages/:pageId", type: "web.page_viewed" },
  { pattern: "/w/:wsId/alerts", type: "web.page_viewed" },
  { pattern: "/w/:wsId/alerts/sms-calls", type: "web.page_viewed" },
  { pattern: "/w/:wsId/secrets", type: "web.page_viewed" },
  { pattern: "/w/:wsId/members", type: "web.page_viewed" },
  { pattern: "/w/:wsId/billing", type: "web.page_viewed" },
  { pattern: "/w/:wsId/settings", type: "web.page_viewed" },
];

/**
 * Turns a concrete pathname into the visit event to record, or `null` for
 * public and unknown paths. `properties.page` always carries the route
 * pattern, never the concrete path: ids travel in `workspaceId`/`resourceId`.
 */
export function visitEventFor(pathname: string): ClientEvent | null {
  for (const route of ROUTE_EVENTS) {
    const match = matchPath({ path: route.pattern, end: true }, pathname);
    if (match === null) continue;
    const workspaceId = match.params.wsId;
    const resourceId = route.resourceParam ? match.params[route.resourceParam] : undefined;
    return {
      type: route.type,
      ...(workspaceId ? { workspaceId } : {}),
      ...(resourceId ? { resourceId } : {}),
      properties: { page: route.pattern },
    };
  }
  return null;
}

/**
 * Public pages that genuinely render content. Capability-bearing routes are
 * represented by their templates so tokens can never reach analytics.
 */
const PUBLIC_ANALYTICS_ROUTES: ReadonlyArray<AnalyticsRoute> = [
  { pattern: "/signin" },
  { pattern: "/signup" },
  { pattern: "/forgot-password" },
  { pattern: "/reset-password" },
  { pattern: "/verify-email" },
  { pattern: "/verify-pending" },
  { pattern: "/invitations/accept" },
  { pattern: "/invitations/:token" },
  { pattern: "/grants/redeem" },
  { pattern: "/grants/:token" },
  { pattern: "/privacy" },
  { pattern: "/terms" },
  { pattern: "/legal-notice" },
  { pattern: "/cookies" },
];

export const ANALYTICS_ROUTE_PATTERNS: ReadonlyArray<string> = [
  ...PUBLIC_ANALYTICS_ROUTES.map((route) => route.pattern),
  ...ROUTE_EVENTS.map((route) => route.pattern),
  "/404",
];

export type AnalyticsAppSection =
  | "alerts"
  | "auth"
  | "billing"
  | "error"
  | "incidents"
  | "legal"
  | "onboarding"
  | "overview"
  | "runs"
  | "security"
  | "settings"
  | "status_pages"
  | "team"
  | "tests"
  | "uptime";

export type AnalyticsContentGroup =
  | "app_auth"
  | "app_billing"
  | "app_legal"
  | "app_onboarding"
  | "app_product"
  | "error";

export interface AnalyticsRouteClassification {
  appSection: AnalyticsAppSection;
  contentGroup: AnalyticsContentGroup;
}

/**
 * Low-cardinality reporting taxonomy for the app host. It accepts only the
 * allow-listed route templates above, so resource identifiers can never become
 * analytics dimensions.
 */
export function analyticsClassificationFor(
  routePattern: string,
): AnalyticsRouteClassification | null {
  if (!isAnalyticsRoutePattern(routePattern)) return null;

  if (routePattern === "/404") {
    return { appSection: "error", contentGroup: "error" };
  }
  if (["/privacy", "/terms", "/legal-notice", "/cookies"].includes(routePattern)) {
    return { appSection: "legal", contentGroup: "app_legal" };
  }
  if (
    routePattern === "/onboarding/workspace" ||
    routePattern === "/w/:wsId/setup/billing"
  ) {
    return { appSection: "onboarding", contentGroup: "app_onboarding" };
  }
  if (routePattern === "/complimentary" || routePattern.startsWith("/grants/") || routePattern.endsWith("/billing")) {
    return { appSection: "billing", contentGroup: "app_billing" };
  }
  if (
    routePattern === "/signin" ||
    routePattern === "/signup" ||
    routePattern === "/forgot-password" ||
    routePattern === "/reset-password" ||
    routePattern === "/verify-email" ||
    routePattern === "/verify-pending" ||
    routePattern.startsWith("/invitations/")
  ) {
    return { appSection: "auth", contentGroup: "app_auth" };
  }

  let appSection: AnalyticsAppSection;
  if (routePattern.endsWith("/overview")) appSection = "overview";
  else if (routePattern.includes("/tests")) appSection = "tests";
  else if (routePattern.includes("/runs/")) appSection = "runs";
  else if (routePattern.includes("/uptime")) appSection = "uptime";
  else if (routePattern.includes("/incidents")) appSection = "incidents";
  else if (routePattern.includes("/status-pages")) appSection = "status_pages";
  else if (routePattern.includes("/alerts")) appSection = "alerts";
  else if (routePattern.endsWith("/secrets")) appSection = "security";
  else if (routePattern.endsWith("/members")) appSection = "team";
  else appSection = "settings";

  return { appSection, contentGroup: "app_product" };
}

export function isAnalyticsRoutePattern(value: string): boolean {
  return ANALYTICS_ROUTE_PATTERNS.includes(value);
}

/**
 * Returns only an allow-listed route template. Redirect-only locations emit no
 * view, while an unknown path is collapsed to `/404` rather than exposing it.
 */
export function analyticsRoutePatternFor(pathname: string): string | null {
  for (const route of PUBLIC_ANALYTICS_ROUTES) {
    if (matchPath({ path: route.pattern, end: true }, pathname) !== null) {
      return route.pattern;
    }
  }

  const authenticated = visitEventFor(pathname);
  if (authenticated !== null) return authenticated.properties.page;

  if (
    pathname === "/" ||
    matchPath({ path: "/w/:wsId", end: true }, pathname) !== null ||
    matchPath({ path: "/w/:wsId/notifications", end: true }, pathname) !== null
  ) {
    return null;
  }
  return "/404";
}
