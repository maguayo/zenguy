import {
  apiDelete,
  apiGet,
  apiGetPage,
  apiPatch,
  apiPost,
  type ApiPage,
} from "../lib/api";
import type { AuditEntry, Workspace } from "./types";

export interface UpdateWorkspaceInput {
  name?: string;
  timezone?: string;
}

function workspacePath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function listWorkspaces(): Promise<Workspace[]> {
  return apiGet("/api/workspaces");
}

export function getWorkspace(workspaceId: string): Promise<Workspace> {
  return apiGet(workspacePath(workspaceId));
}

export function updateWorkspace(
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  return apiPatch(workspacePath(workspaceId), input);
}

export function deleteWorkspace(workspaceId: string, confirmName: string): Promise<void> {
  return apiDelete(workspacePath(workspaceId), { confirmName });
}

export function transferOwnership(
  workspaceId: string,
  newOwnerUserId: string,
): Promise<{ ok: true }> {
  return apiPost(`${workspacePath(workspaceId)}/transfer-ownership`, {
    newOwnerUserId,
  });
}

export function auditLogsPath(
  workspaceId: string,
  cursor?: string | null,
  limit = 25,
): string {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set("cursor", cursor);
  return `${workspacePath(workspaceId)}/audit-logs?${search}`;
}

export function listAuditLogs(
  workspaceId: string,
  cursor?: string | null,
  limit = 25,
): Promise<ApiPage<AuditEntry>> {
  return apiGetPage(auditLogsPath(workspaceId, cursor, limit));
}
