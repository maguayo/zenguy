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
