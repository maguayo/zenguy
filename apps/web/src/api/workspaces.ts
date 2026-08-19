import { apiGet, apiPost } from "../lib/api";
import type { Workspace } from "./types";

export interface CreateWorkspaceInput {
  name: string;
  timezone: string;
}

export function listWorkspaces(): Promise<Workspace[]> {
  return apiGet("/api/workspaces");
}

export function getWorkspace(workspaceId: string): Promise<Workspace> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}`);
}

export function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  return apiPost("/api/workspaces", input);
}
