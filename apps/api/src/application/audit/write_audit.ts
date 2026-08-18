import type { AuditAction } from "../../domain/audit/actions";
import type { AuditRepo } from "../../domain/audit/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import {
  sanitizeAuditMetadata,
  truncate,
  type AuditMetadataValue,
} from "../../shared/redact";

export interface WriteAuditInput {
  workspaceId: string;
  actorUserId: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, AuditMetadataValue>;
  ip?: string;
}

export interface WriteAuditDependencies {
  audits: AuditRepo;
  clock: Clock;
  ids: IdGenerator;
}

export class WriteAudit {
  constructor(private readonly dependencies: WriteAuditDependencies) {}

  async execute(input: WriteAuditInput): Promise<void> {
    try {
      const metadataJson =
        input.metadata === undefined
          ? null
          : truncate(
              JSON.stringify(sanitizeAuditMetadata(input.metadata)),
              2_000,
            );
      await this.dependencies.audits.insert({
        id: this.dependencies.ids.newId("aud"),
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        metadataJson,
        ip: input.ip ?? null,
        createdAt: this.dependencies.clock.now(),
      });
    } catch {
      logEvent("audit_write_failed");
    }
  }
}
