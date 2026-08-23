import type { ActivityEventType } from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent, ActivitySource } from "../../domain/activity/types";
import { all, batch, run } from "./d1";

interface ActivityRow {
  id: string;
  type: ActivityEventType;
  user_id: string | null;
  workspace_id: string | null;
  source: ActivitySource;
  resource_type: string | null;
  resource_id: string | null;
  properties_json: string | null;
  occurred_at: number;
}

function toEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    source: row.source,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    propertiesJson: row.properties_json,
    occurredAt: row.occurred_at,
  };
}

const INSERT = `INSERT INTO activity_events
  (id, type, user_id, workspace_id, source, resource_type, resource_id, properties_json, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export class D1ActivityEventRepo implements ActivityEventRepo {
  constructor(private readonly database: D1Database) {}

  private insertStatement(event: ActivityEvent): D1PreparedStatement {
    return this.database
      .prepare(INSERT)
      .bind(
        event.id,
        event.type,
        event.userId,
        event.workspaceId,
        event.source,
        event.resourceType,
        event.resourceId,
        event.propertiesJson,
        event.occurredAt,
      );
  }

  async insert(event: ActivityEvent): Promise<void> {
    await run(this.insertStatement(event));
  }

  async insertMany(events: ActivityEvent[]): Promise<void> {
    if (events.length === 0) return;
    await batch(
      this.database,
      events.map((event) => this.insertStatement(event)),
    );
  }

  async deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number> {
    if (types.length === 0 || limit <= 0) return 0;
    const placeholders = types.map(() => "?").join(", ");
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM activity_events WHERE id IN (
             SELECT id FROM activity_events
             WHERE occurred_at < ? AND type IN (${placeholders})
             ORDER BY occurred_at ASC LIMIT ?
           )`,
        )
        .bind(before, ...types, limit),
    );
    return result.meta.changes ?? 0;
  }

  async listRecent(limit: number): Promise<ActivityEvent[]> {
    return (
      await all<ActivityRow>(
        this.database
          .prepare(
            `SELECT * FROM activity_events
             ORDER BY occurred_at DESC, id DESC LIMIT ?`,
          )
          .bind(limit),
      )
    ).map(toEvent);
  }
}
