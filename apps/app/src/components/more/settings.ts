import { z } from "zod";

import type { AuditEntry, Member } from "@/api/types";

export const workspaceSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
  timezone: z.string().min(1, "Choose a timezone."),
});

export type WorkspaceSettingsValues = z.infer<typeof workspaceSettingsSchema>;

export function transferCandidates(members: Member[], actorUserId: string): Member[] {
  return members.filter((member) => member.userId !== actorUserId);
}

export function prettyAuditMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2);
}

export function auditActorName(entry: AuditEntry): string {
  return entry.actor?.name ?? "System";
}

/** "secret · secret_1", or null when the entry has no resource at all. */
export function auditResourceLabel(entry: AuditEntry): string | null {
  if (!entry.resourceType && !entry.resourceId) return null;
  return `${entry.resourceType ?? "resource"} · ${entry.resourceId ?? "—"}`;
}

export const transferOwnershipDescription =
  "Give another existing member full control of this workspace.";

export const deleteWorkspaceDescription =
  "Permanently remove this workspace and its data after retention.";

export const deleteWorkspaceWarning =
  "This stops all scheduled runs and checks, revokes invitations, and permanently removes data after the retention window. Type the workspace name to confirm.";

/** Deletion only proceeds when the exact workspace name was typed. */
export function canConfirmDeletion(input: string, workspaceName: string): boolean {
  return input.trim() === workspaceName;
}
