import {
  ACTIVITY_EVENT_SPECS,
  isActivityEventType,
  type ActivityEventType,
} from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent, ActivitySource } from "../../domain/activity/types";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import {
  sanitizeAuditMetadata,
  type AuditMetadataValue,
} from "../../shared/redact";

export const ACTIVITY_PROPERTIES_MAX_CHARS = 2_000;

export interface TrackEventInput {
  type: ActivityEventType;
  userId: string | null;
  workspaceId?: string | null;
  source: ActivitySource;
  resourceId?: string | null;
  properties?: Record<string, AuditMetadataValue>;
}

export interface TrackEventDependencies {
  activity: Pick<ActivityEventRepo, "insert">;
  clock: Clock;
  ids: IdGenerator;
}

function serializeActivityProperties(
  properties: Record<string, AuditMetadataValue>,
): string {
  const serialized = JSON.stringify(sanitizeAuditMetadata(properties));
  if (serialized.length <= ACTIVITY_PROPERTIES_MAX_CHARS) return serialized;

  // Cutting the serialized string directly can leave invalid JSON. Preserve a
  // bounded, already-redacted preview inside a valid JSON envelope instead.
  let lower = 0;
  let upper = serialized.length;
  let result = JSON.stringify({ truncated: true, preview: "" });
  while (lower <= upper) {
    const midpoint = Math.floor((lower + upper) / 2);
    const candidate = JSON.stringify({
      truncated: true,
      preview: serialized.slice(0, midpoint),
    });
    if (candidate.length <= ACTIVITY_PROPERTIES_MAX_CHARS) {
      result = candidate;
      lower = midpoint + 1;
    } else {
      upper = midpoint - 1;
    }
  }
  return result;
}

/**
 * Pure builder shared by `TrackEvent` and the client ingestion use case.
 * Returns null when the input does not respect the catalog (unknown type,
 * workspace-scoped type without a workspace, user-scoped type with one).
 */
export function buildActivityEvent(
  input: TrackEventInput,
  dependencies: Pick<TrackEventDependencies, "clock" | "ids">,
): ActivityEvent | null {
  if (!isActivityEventType(input.type)) return null;
  const spec = ACTIVITY_EVENT_SPECS[input.type];
  const workspaceId = input.workspaceId ?? null;
  if (spec.scope === "workspace" && workspaceId === null) return null;
  if (spec.scope === "user" && workspaceId !== null) return null;
  const resourceId = input.resourceId ?? null;
  const propertiesJson =
    input.properties === undefined
      ? null
      : serializeActivityProperties(input.properties);
  return {
    id: dependencies.ids.newId("act"),
    type: input.type,
    userId: input.userId,
    workspaceId,
    source: input.source,
    resourceType: resourceId === null ? null : spec.resourceType,
    resourceId,
    propertiesJson,
    occurredAt: dependencies.clock.now(),
  };
}

/** Records one activity event. Never throws: analytics must not break use cases. */
export class TrackEvent {
  constructor(private readonly dependencies: TrackEventDependencies) {}

  async execute(input: TrackEventInput): Promise<void> {
    try {
      const event = buildActivityEvent(input, this.dependencies);
      if (event === null) {
        logEvent("activity_event_rejected", { type: String(input.type) });
        return;
      }
      await this.dependencies.activity.insert(event);
    } catch {
      logEvent("activity_write_failed", { type: String(input.type) });
    }
  }
}
