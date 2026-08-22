import type {
  BrowserTestRepo,
  BrowserTestUpdate,
} from "../../domain/browser_tests/repo";
import type {
  BrowserTest,
  ClaimedBrowserTest,
  Device,
} from "../../domain/browser_tests/types";
import { all, batch, one, run } from "./d1";

interface BrowserTestRow {
  id: string;
  workspace_id: string;
  name: string;
  start_url: string;
  instructions: string;
  device: Device;
  interval_hours: number;
  max_retries: number;
  notify_on_recovery: number;
  next_run_at: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toBrowserTest(row: BrowserTestRow): BrowserTest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    startUrl: row.start_url,
    instructions: row.instructions,
    device: row.device,
    intervalHours: row.interval_hours,
    maxRetries: row.max_retries,
    notifyOnRecovery: row.notify_on_recovery === 1,
    nextRunAt: row.next_run_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export class D1BrowserTestRepo implements BrowserTestRepo {
  constructor(private readonly database: D1Database) {}

  async insert(test: BrowserTest): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO browser_tests
            (id, workspace_id, name, start_url, instructions, device,
             interval_hours, max_retries, notify_on_recovery, next_run_at,
             created_by, updated_by, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          test.id,
          test.workspaceId,
          test.name,
          test.startUrl,
          test.instructions,
          test.device,
          test.intervalHours,
          test.maxRetries,
          test.notifyOnRecovery ? 1 : 0,
          test.nextRunAt,
          test.createdBy,
          test.updatedBy,
          test.createdAt,
          test.updatedAt,
          test.deletedAt,
        ),
    );
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<BrowserTest | null> {
    const row = await one<BrowserTestRow>(
      this.database
        .prepare(
          `SELECT * FROM browser_tests
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toBrowserTest(row);
  }

  async list(workspaceId: string): Promise<BrowserTest[]> {
    return (
      await all<BrowserTestRow>(
        this.database
          .prepare(
            `SELECT * FROM browser_tests
             WHERE workspace_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC, id DESC`,
          )
          .bind(workspaceId),
      )
    ).map(toBrowserTest);
  }

  async update(
    id: string,
    changes: BrowserTestUpdate,
    at: number,
  ): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (changes.name !== undefined) add("name", changes.name);
    if (changes.startUrl !== undefined) add("start_url", changes.startUrl);
    if (changes.instructions !== undefined) {
      add("instructions", changes.instructions);
    }
    if (changes.device !== undefined) add("device", changes.device);
    if (changes.intervalHours !== undefined) {
      add("interval_hours", changes.intervalHours);
    }
    if (changes.maxRetries !== undefined) {
      add("max_retries", changes.maxRetries);
    }
    if (changes.notifyOnRecovery !== undefined) {
      add("notify_on_recovery", changes.notifyOnRecovery ? 1 : 0);
    }
    if (changes.nextRunAt !== undefined) {
      add("next_run_at", changes.nextRunAt);
    }
    if (changes.updatedBy !== undefined) add("updated_by", changes.updatedBy);
    add("updated_at", at);
    await run(
      this.database
        .prepare(
          `UPDATE browser_tests SET ${assignments.join(", ")}
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(...values, id),
    );
  }

  async softDelete(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE browser_tests SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(at, at, id),
    );
  }

  async setNextRunAt(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE browser_tests SET next_run_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(at, id),
    );
  }

  async claimDue(now: number, limit: number): Promise<ClaimedBrowserTest[]> {
    const due = await all<BrowserTestRow>(
      this.database
        .prepare(
          `SELECT * FROM browser_tests
           WHERE deleted_at IS NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC, id ASC LIMIT ?`,
        )
        .bind(now, limit),
    );
    const claimed = await Promise.all(
      due.map(async (row): Promise<ClaimedBrowserTest | null> => {
        const nextRunAt = now + row.interval_hours * 3_600_000;
        const result = await run(
          this.database
            .prepare(
              `UPDATE browser_tests SET next_run_at = ?
               WHERE id = ? AND next_run_at = ? AND deleted_at IS NULL`,
            )
            .bind(nextRunAt, row.id, row.next_run_at),
        );
        if (result.meta.changes !== 1) return null;
        return {
          ...toBrowserTest(row),
          nextRunAt,
          scheduledFor: row.next_run_at,
        };
      }),
    );
    return claimed.filter(
      (test): test is ClaimedBrowserTest => test !== null,
    );
  }

  async setChannels(testId: string, channelIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(channelIds)];
    await batch(this.database, [
      this.database
        .prepare("DELETE FROM browser_test_channels WHERE browser_test_id = ?")
        .bind(testId),
      ...uniqueIds.map((channelId) =>
        this.database
          .prepare(
            `INSERT INTO browser_test_channels
              (browser_test_id, notification_channel_id) VALUES (?, ?)`,
          )
          .bind(testId, channelId),
      ),
    ]);
  }

  async addChannelToAll(workspaceId: string, channelId: string): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT OR IGNORE INTO browser_test_channels
            (browser_test_id, notification_channel_id)
           SELECT id, ? FROM browser_tests
           WHERE workspace_id = ? AND deleted_at IS NULL`,
        )
        .bind(channelId, workspaceId),
    );
  }

  async getChannelIds(testId: string): Promise<string[]> {
    const rows = await all<{ notification_channel_id: string }>(
      this.database
        .prepare(
          `SELECT notification_channel_id FROM browser_test_channels
           WHERE browser_test_id = ? ORDER BY notification_channel_id ASC`,
        )
        .bind(testId),
    );
    return rows.map(({ notification_channel_id }) => notification_channel_id);
  }
}
