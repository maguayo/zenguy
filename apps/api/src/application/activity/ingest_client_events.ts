import {
  ACTIVITY_EVENT_SPECS,
  isActivityEventType,
} from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent } from "../../domain/activity/types";
import type { MemberRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { buildActivityEvent } from "./track_event";

export const MAX_CLIENT_EVENTS_PER_BATCH = 25;

export interface ClientEventInput {
  type: string;
  workspaceId?: string;
  resourceId?: string;
  properties?: Record<string, string | number | boolean>;
}

export interface IngestClientEventsInput {
  userId: string;
  source: "web" | "app";
  events: ClientEventInput[];
}

export interface IngestClientEventsResult {
  accepted: number;
  dropped: number;
}

export interface IngestClientEventsDependencies {
  activity: Pick<ActivityEventRepo, "insertMany">;
  members: Pick<MemberRepo, "find">;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Accepts a batch of client-reported events (visits). Anything a client may
 * not report — unknown types, server-only types, scope violations, foreign
 * workspaces — is dropped without an error so the response never reveals
 * whether a workspace exists.
 */
export class IngestClientEvents {
  constructor(private readonly dependencies: IngestClientEventsDependencies) {}

  async execute(input: IngestClientEventsInput): Promise<IngestClientEventsResult> {
    const memberships = new Map<string, Promise<boolean>>();
    const isMember = (workspaceId: string): Promise<boolean> => {
      let pending = memberships.get(workspaceId);
      if (pending === undefined) {
        pending = this.dependencies.members
          .find(workspaceId, input.userId)
          .then((member) => member !== null);
        memberships.set(workspaceId, pending);
      }
      return pending;
    };

    const accepted: ActivityEvent[] = [];
    // Keep the application boundary bounded even if a future route or queue
    // forgets to apply the HTTP schema's batch limit.
    for (const candidate of input.events.slice(0, MAX_CLIENT_EVENTS_PER_BATCH)) {
      if (!isActivityEventType(candidate.type)) continue;
      if (!ACTIVITY_EVENT_SPECS[candidate.type].client) continue;
      if (candidate.workspaceId !== undefined && !(await isMember(candidate.workspaceId))) {
        continue;
      }
      const event = buildActivityEvent(
        {
          type: candidate.type,
          userId: input.userId,
          workspaceId: candidate.workspaceId ?? null,
          source: input.source,
          resourceId: candidate.resourceId ?? null,
          ...(candidate.properties === undefined ? {} : { properties: candidate.properties }),
        },
        this.dependencies,
      );
      if (event === null) continue;
      accepted.push(event);
    }

    if (accepted.length > 0) {
      await this.dependencies.activity.insertMany(accepted);
    }
    return { accepted: accepted.length, dropped: input.events.length - accepted.length };
  }
}
