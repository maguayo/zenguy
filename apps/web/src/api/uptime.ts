import {
  apiDelete,
  apiGet,
  apiGetPage,
  apiPatch,
  apiPost,
  type ApiPage,
} from "../lib/api";
import type {
  Check,
  Monitor,
  MonitorInput,
  MonitorStats,
  TestRequestResult,
} from "./types";

function uptimePath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/uptime-monitors`;
}

export function monitorPath(workspaceId: string, monitorId: string): string {
  return `${uptimePath(workspaceId)}/${encodeURIComponent(monitorId)}`;
}

export function checksPath(
  workspaceId: string,
  monitorId: string,
  options: { cursor?: string | null; limit?: number } = {},
): string {
  const search = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.cursor) search.set("cursor", options.cursor);
  return `${monitorPath(workspaceId, monitorId)}/checks?${search}`;
}

export function listMonitors(workspaceId: string): Promise<Monitor[]> {
  return apiGet(uptimePath(workspaceId));
}

export function getMonitor(workspaceId: string, monitorId: string): Promise<Monitor> {
  return apiGet(monitorPath(workspaceId, monitorId));
}

export function createMonitor(workspaceId: string, input: MonitorInput): Promise<Monitor> {
  return apiPost(uptimePath(workspaceId), input);
}

export function updateMonitor(
  workspaceId: string,
  monitorId: string,
  input: Partial<MonitorInput>,
): Promise<Monitor> {
  return apiPatch(monitorPath(workspaceId, monitorId), input);
}

export function deleteMonitor(workspaceId: string, monitorId: string): Promise<void> {
  return apiDelete(monitorPath(workspaceId, monitorId));
}

export function testRequest(
  workspaceId: string,
  input: MonitorInput,
): Promise<TestRequestResult> {
  return apiPost(`${uptimePath(workspaceId)}/test-request`, input);
}

export function listChecks(
  workspaceId: string,
  monitorId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ApiPage<Check>> {
  return apiGetPage(checksPath(workspaceId, monitorId, options));
}

export function getStats(workspaceId: string, monitorId: string): Promise<MonitorStats> {
  return apiGet(`${monitorPath(workspaceId, monitorId)}/stats`);
}
