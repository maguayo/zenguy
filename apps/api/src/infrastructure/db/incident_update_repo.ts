import type { IncidentUpdateRepo } from "../../domain/status_pages/repo";
import type { IncidentUpdate } from "../../domain/status_pages/types";
import { all, one, run } from "./d1";

interface IncidentUpdateRow {
  id: string;
  incident_id: string;
  workspace_id: string;
  message: string;
  created_by: string | null;
  created_at: number;
}

function toUpdate(row: IncidentUpdateRow): IncidentUpdate {
  return {
    id: row.id,
    incidentId: row.incident_id,
    workspaceId: row.workspace_id,
    message: row.message,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export class D1IncidentUpdateRepo implements IncidentUpdateRepo {
  constructor(private readonly database: D1Database) {}

  async insert(update: IncidentUpdate): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO incident_updates
            (id, incident_id, workspace_id, message, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          update.id,
          update.incidentId,
          update.workspaceId,
          update.message,
          update.createdBy,
          update.createdAt,
        ),
    );
  }

  async listForIncident(incidentId: string): Promise<IncidentUpdate[]> {
    const rows = await all<IncidentUpdateRow>(
      this.database
        .prepare(
          `SELECT * FROM incident_updates
           WHERE incident_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(incidentId),
    );
    return rows.map(toUpdate);
  }

  async listForIncidents(
    workspaceId: string,
    incidentIds: string[],
  ): Promise<Map<string, IncidentUpdate[]>> {
    const grouped = new Map<string, IncidentUpdate[]>();
    if (incidentIds.length === 0) return grouped;
    const placeholders = incidentIds.map(() => "?").join(", ");
    const rows = await all<IncidentUpdateRow>(
      this.database
        .prepare(
          `SELECT * FROM incident_updates
           WHERE workspace_id = ? AND incident_id IN (${placeholders})
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId, ...incidentIds),
    );
    for (const row of rows) {
      const updates = grouped.get(row.incident_id) ?? [];
      updates.push(toUpdate(row));
      grouped.set(row.incident_id, updates);
    }
    return grouped;
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<IncidentUpdate | null> {
    const row = await one<IncidentUpdateRow>(
      this.database
        .prepare(
          "SELECT * FROM incident_updates WHERE workspace_id = ? AND id = ?",
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toUpdate(row);
  }

  async remove(id: string): Promise<void> {
    await run(
      this.database
        .prepare("DELETE FROM incident_updates WHERE id = ?")
        .bind(id),
    );
  }
}
