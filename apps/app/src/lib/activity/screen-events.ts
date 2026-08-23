export type ClientEventType =
  | "app.screen_viewed"
  | "app.opened"
  | "browser_test.viewed"
  | "run.viewed"
  | "uptime_monitor.viewed"
  | "incident.viewed";

export interface ClientEvent {
  type: ClientEventType;
  workspaceId?: string;
  resourceId?: string;
  properties: Record<string, string | number | boolean>;
}

export interface ClientMeta {
  appVersion: string | null;
}

/**
 * Screens reachable without a session (or public link pages). Nothing is ever
 * recorded for them, even when the visitor happens to be signed in.
 */
// Public screens, plus the one authenticated screen an unverified account can
// reach: the API only accepts events from verified accounts.
const PUBLIC_SCREENS = new Set([
  "/",
  "/verify-pending",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
  "/verify-email",
  "/invitations/[token]",
  "/invitations/accept",
  "/grants/[token]",
  "/grants/redeem",
]);

/** Screens that become a typed resource visit; every other authenticated screen is `app.screen_viewed`. */
const RESOURCE_SCREENS: readonly { screen: string; type: ClientEventType; param: string }[] = [
  { screen: "/w/[wsId]/tests/[testId]", type: "browser_test.viewed", param: "testId" },
  { screen: "/w/[wsId]/tests/[testId]/edit", type: "browser_test.viewed", param: "testId" },
  { screen: "/w/[wsId]/runs/[runId]", type: "run.viewed", param: "runId" },
  { screen: "/w/[wsId]/uptime/[monitorId]", type: "uptime_monitor.viewed", param: "monitorId" },
  { screen: "/w/[wsId]/uptime/[monitorId]/edit", type: "uptime_monitor.viewed", param: "monitorId" },
  { screen: "/w/[wsId]/incidents/[incidentId]", type: "incident.viewed", param: "incidentId" },
];

/** `["w","[wsId]","(tabs)","(tests)","tests","[testId]"]` → `/w/[wsId]/tests/[testId]`. */
export function screenPattern(segments: readonly string[]): string {
  const visible = segments.filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${visible.join("/")}`;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function baseProperties(screen: string, meta: ClientMeta): Record<string, string> {
  return { screen, appVersion: meta.appVersion ?? "", platform: "ios" };
}

/**
 * Builds the visit event for the current expo-router location. `properties.screen`
 * always carries the pattern (`/w/[wsId]/tests/[testId]`), never concrete ids: those
 * travel in `workspaceId` / `resourceId`. Public screens yield `null`.
 */
export function visitEventFor(
  segments: readonly string[],
  params: Record<string, string | string[] | undefined>,
  meta: ClientMeta,
): ClientEvent | null {
  const screen = screenPattern(segments);
  if (PUBLIC_SCREENS.has(screen)) return null;
  const workspaceId = single(params.wsId);
  const resource = RESOURCE_SCREENS.find((entry) => entry.screen === screen);
  if (resource !== undefined) {
    const resourceId = single(params[resource.param]);
    if (workspaceId === undefined || resourceId === undefined) return null;
    return { type: resource.type, workspaceId, resourceId, properties: baseProperties(screen, meta) };
  }
  return {
    type: "app.screen_viewed",
    ...(workspaceId === undefined ? {} : { workspaceId }),
    properties: baseProperties(screen, meta),
  };
}

export function appOpenedEvent(meta: ClientMeta): ClientEvent {
  return { type: "app.opened", properties: { appVersion: meta.appVersion ?? "", platform: "ios" } };
}
