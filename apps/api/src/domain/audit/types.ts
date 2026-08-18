import type { AuditAction } from "./actions";

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: AuditAction;
  resourceType: string | null;
  resourceId: string | null;
  metadataJson: string | null;
  ip: string | null;
  createdAt: number;
}
