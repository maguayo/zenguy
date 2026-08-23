import { AUDIT_TO_ACTIVITY } from "../../domain/activity/catalog";
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
import type { TrackEvent } from "../activity/track_event";

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
  /** Optional bridge: every audited mutation also becomes an activity event. */
  activity?: Pick<TrackEvent, "execute">;
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
      // Bridge only after the audit row is persisted. `TrackEvent` sanitizes
      // the raw metadata itself and never throws, so it cannot reach the catch.
      await this.dependencies.activity?.execute({
        type: AUDIT_TO_ACTIVITY[input.action],
        userId: input.actorUserId,
        workspaceId: input.workspaceId,
        source: "server",
        resourceId: input.resourceId ?? null,
        ...(input.metadata === undefined ? {} : { properties: input.metadata }),
      });
    } catch {
      logEvent("audit_write_failed");
    }
  }
}
