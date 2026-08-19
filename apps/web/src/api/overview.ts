import { apiGet } from "../lib/api";
import type { Overview } from "./types";

export function getOverview(workspaceId: string): Promise<Overview> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}/overview`);
}
