import type { Href } from "expo-router";

// The URLs of the uptime area, identical to the web app. They are built from
// strings (like the rest of the app) and typed as `Href` here, in one place,
// because expo-router's generated route union only lists the routes that
// existed when it was last generated.
function href(path: string): Href {
  return path as Href;
}

export function uptimeHref(workspaceId: string): Href {
  return href(`/w/${workspaceId}/uptime`);
}

export function newMonitorHref(workspaceId: string): Href {
  return href(`/w/${workspaceId}/uptime/new`);
}

export function monitorHref(workspaceId: string, monitorId: string): Href {
  return href(`/w/${workspaceId}/uptime/${monitorId}`);
}

export function editMonitorHref(workspaceId: string, monitorId: string): Href {
  return href(`/w/${workspaceId}/uptime/${monitorId}/edit`);
}

export function incidentHref(workspaceId: string, incidentId: string): Href {
  return href(`/w/${workspaceId}/incidents/${incidentId}`);
}
