import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import type { Invitation, Member } from "./types";

function membersPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/members`;
}

function invitationsPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`;
}

export function memberPath(workspaceId: string, userId: string): string {
  return `${membersPath(workspaceId)}/${encodeURIComponent(userId)}`;
}

export function invitationPath(workspaceId: string, invitationId: string): string {
  return `${invitationsPath(workspaceId)}/${encodeURIComponent(invitationId)}`;
}

export function listMembers(workspaceId: string): Promise<Member[]> {
  return apiGet(membersPath(workspaceId));
}

export function changeRole(
  workspaceId: string,
  userId: string,
  role: "ADMIN" | "MEMBER",
): Promise<Member> {
  return apiPatch(memberPath(workspaceId, userId), { role });
}

export function removeMember(workspaceId: string, userId: string): Promise<void> {
  return apiDelete(memberPath(workspaceId, userId));
}

export function listInvitations(workspaceId: string): Promise<Invitation[]> {
  return apiGet(invitationsPath(workspaceId));
}

export function invite(
  workspaceId: string,
  input: { email: string; role: "ADMIN" | "MEMBER" },
): Promise<Invitation> {
  return apiPost(invitationsPath(workspaceId), input);
}

export function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  return apiDelete(invitationPath(workspaceId, invitationId));
}
