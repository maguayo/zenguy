import type { IncidentEventRepo } from "../../domain/incidents/repo";
import type {
  IncidentEvent,
  IncidentEventType,
} from "../../domain/incidents/types";
import { all, run } from "./d1";

interface IncidentEventRow {
  id: string;
  incident_id: string;
  type: IncidentEventType;
  source_id: string | null;
  message: string;
  metadata_json: string | null;
  created_at: number;
}

function toIncidentEvent(row: IncidentEventRow): IncidentEvent {
  return {
    id: row.id,
    incidentId: row.incident_id,
    type: row.type,
    sourceId: row.source_id,
    message: row.message,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
  };
}

export class D1IncidentEventRepo implements IncidentEventRepo {
  constructor(private readonly database: D1Database) {}

  async insert(event: IncidentEvent): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO incident_events
            (id, incident_id, type, source_id, message, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(incident_id, type, source_id)
             WHERE source_id IS NOT NULL DO NOTHING`,
        )
        .bind(
          event.id,
          event.incidentId,
          event.type,
          event.sourceId,
          event.message,
          event.metadataJson,
          event.createdAt,
        ),
    );
  }

  async listForIncident(incidentId: string): Promise<IncidentEvent[]> {
    const rows = await all<IncidentEventRow>(
      this.database
        .prepare(
          `SELECT * FROM incident_events
           WHERE incident_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .bind(incidentId),
    );
    return rows.map(toIncidentEvent);
  }
}
