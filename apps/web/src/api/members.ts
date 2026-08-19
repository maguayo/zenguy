import { apiGet } from "../lib/api";
import type { Member } from "./types";

export function listMembers(workspaceId: string): Promise<Member[]> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`);
}
