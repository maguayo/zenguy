import { apiGet, apiPost } from "../lib/api";
import type { PublicInvitation } from "./types";

export function getInvitation(token: string): Promise<PublicInvitation> {
  return apiGet(`/api/invitations/${encodeURIComponent(token)}`);
}

export function acceptInvitation(token: string): Promise<{ workspaceId: string }> {
  return apiPost(`/api/invitations/${encodeURIComponent(token)}/accept`);
}
