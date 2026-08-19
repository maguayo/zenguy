import { apiGet } from "../lib/api";
import type { Workspace } from "./types";

export function listWorkspaces(): Promise<Workspace[]> {
  return apiGet("/api/workspaces");
}

export function getWorkspace(workspaceId: string): Promise<Workspace> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}`);
}
