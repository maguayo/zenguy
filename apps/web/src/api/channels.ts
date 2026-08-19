import { apiGet } from "../lib/api";
import type { Channel } from "./types";

export function listChannels(workspaceId: string): Promise<Channel[]> {
  return apiGet(`/api/workspaces/${encodeURIComponent(workspaceId)}/channels`);
}
