import type { AuditLogOutput } from "../../application/audit/list_audit_logs";

export function presentAuditLog(entry: AuditLogOutput) {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt).toISOString(),
  };
}
