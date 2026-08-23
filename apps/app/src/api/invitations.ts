import { apiPost } from "../lib/api";
import type { PublicInvitation } from "./types";

export function getInvitation(token: string): Promise<PublicInvitation> {
  return apiPost("/api/invitations/preview", { token });
}

export function acceptInvitation(token: string): Promise<{ workspaceId: string }> {
  return apiPost("/api/invitations/accept", { token });
}
