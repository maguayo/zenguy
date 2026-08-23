import type { ArtifactRepo } from "../../domain/browser_tests/repo";
import type {
  ArtifactType,
  RunArtifact,
} from "../../domain/browser_tests/types";
import { all, batch, one, run } from "./d1";

interface ArtifactRow {
  id: string;
  workspace_id: string;
  run_id: string;
  attempt_id: string | null;
  type: ArtifactType;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  metadata_json: string | null;
  created_at: number;
  expires_at: number;
}

function toArtifact(row: ArtifactRow): RunArtifact {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    type: row.type,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class D1ArtifactRepo implements ArtifactRepo {
  constructor(private readonly database: D1Database) {}

  async insert(artifact: RunArtifact): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO run_artifacts
            (id, workspace_id, run_id, attempt_id, type, storage_key,
             mime_type, size_bytes, metadata_json, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          artifact.id,
          artifact.workspaceId,
          artifact.runId,
          artifact.attemptId,
          artifact.type,
          artifact.storageKey,
          artifact.mimeType,
          artifact.sizeBytes,
          artifact.metadataJson,
          artifact.createdAt,
          artifact.expiresAt,
        ),
    );
  }

  async findById(id: string): Promise<RunArtifact | null> {
    const row = await one<ArtifactRow>(
      this.database.prepare("SELECT * FROM run_artifacts WHERE id = ?").bind(id),
    );
    return row === null ? null : toArtifact(row);
  }

  async findByIds(ids: string[]): Promise<RunArtifact[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => "?").join(", ");
    return (
      await all<ArtifactRow>(
        this.database
          .prepare(`SELECT * FROM run_artifacts WHERE id IN (${placeholders})`)
          .bind(...unique),
      )
    ).map(toArtifact);
  }

  async listForAttempt(attemptId: string): Promise<RunArtifact[]> {
    return (
      await all<ArtifactRow>(
        this.database
          .prepare(
            `SELECT * FROM run_artifacts WHERE attempt_id = ?
             ORDER BY created_at ASC, id ASC`,
          )
          .bind(attemptId),
      )
    ).map(toArtifact);
  }

  async listForRun(runId: string): Promise<RunArtifact[]> {
    return (
      await all<ArtifactRow>(
        this.database
          .prepare(
            `SELECT * FROM run_artifacts WHERE run_id = ?
             ORDER BY created_at ASC, id ASC`,
          )
          .bind(runId),
      )
    ).map(toArtifact);
  }

  async findReportForRun(runId: string): Promise<RunArtifact | null> {
    const row = await one<ArtifactRow>(
      this.database
        .prepare(
          `SELECT * FROM run_artifacts
           WHERE run_id = ? AND type = 'MARKDOWN_REPORT'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .bind(runId),
    );
    return row === null ? null : toArtifact(row);
  }

  async listExpired(before: number, limit: number): Promise<RunArtifact[]> {
    return (
      await all<ArtifactRow>(
        this.database
          .prepare(
            `SELECT * FROM run_artifacts WHERE expires_at <= ?
             ORDER BY expires_at ASC, id ASC LIMIT ?`,
          )
          .bind(before, limit),
      )
    ).map(toArtifact);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await batch(
      this.database,
      [...new Set(ids)].map((id) =>
        this.database.prepare("DELETE FROM run_artifacts WHERE id = ?").bind(id),
      ),
    );
  }
}
