import type { StepRepo } from "../../domain/browser_tests/repo";
import type {
  RunStep,
  StepResult,
} from "../../domain/browser_tests/types";
import { all, batch, run } from "./d1";

interface StepRow {
  id: string;
  attempt_id: string;
  sequence: number;
  timestamp: number;
  action_type: string;
  description: string;
  url_sanitized: string | null;
  result: StepResult;
  artifact_id: string | null;
  created_at: number;
}

function toStep(row: StepRow): RunStep {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    actionType: row.action_type,
    description: row.description,
    urlSanitized: row.url_sanitized,
    result: row.result,
    artifactId: row.artifact_id,
    createdAt: row.created_at,
  };
}

export class D1StepRepo implements StepRepo {
  constructor(private readonly database: D1Database) {}

  async insertMany(steps: RunStep[]): Promise<void> {
    if (steps.length === 0) return;
    await batch(
      this.database,
      steps.map((step) =>
        this.database
          .prepare(
            `INSERT INTO run_steps
              (id, attempt_id, sequence, timestamp, action_type, description,
               url_sanitized, result, artifact_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            step.id,
            step.attemptId,
            step.sequence,
            step.timestamp,
            step.actionType,
            step.description,
            step.urlSanitized,
            step.result,
            step.artifactId,
            step.createdAt,
          ),
      ),
    );
  }

  async listForAttempt(attemptId: string): Promise<RunStep[]> {
    return (
      await all<StepRow>(
        this.database
          .prepare(
            `SELECT * FROM run_steps WHERE attempt_id = ?
             ORDER BY sequence ASC`,
          )
          .bind(attemptId),
      )
    ).map(toStep);
  }

  async deleteForAttempt(attemptId: string): Promise<void> {
    await run(
      this.database
        .prepare("DELETE FROM run_steps WHERE attempt_id = ?")
        .bind(attemptId),
    );
  }
}
