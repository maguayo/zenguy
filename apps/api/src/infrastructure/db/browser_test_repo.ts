import type {
  BrowserTestRepo,
  BrowserTestUpdate,
} from "../../domain/browser_tests/repo";
import type {
  BrowserTest,
  ClaimedBrowserTest,
  Device,
} from "../../domain/browser_tests/types";
import type { Cursor } from "../../shared/pagination";
import { irreversibleActionScopeSchema } from "../../domain/browser_tests/rules";
import { all, batch, one, run } from "./d1";

interface BrowserTestRow {
  id: string;
  workspace_id: string;
  name: string;
  allowed_domains_json: string;
  writable_domains_json: string;
  test_data_attested: number;
  irreversible_action_scopes_json: string;
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
  let allowedDomains: string[] = [];
  let writableDomains: string[] = [];
  let irreversibleActionScopes: BrowserTest["irreversibleActionScopes"] = [];
  try {
    const parsed: unknown = JSON.parse(row.allowed_domains_json);
    if (
      Array.isArray(parsed) &&
      parsed.length <= 20 &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      allowedDomains = parsed;
    }
  } catch {
    // Invalid legacy/corrupt policy data must fail closed.
  }
  try {
    const parsed: unknown = JSON.parse(row.writable_domains_json);
    if (
      Array.isArray(parsed) &&
      parsed.length <= 20 &&
      parsed.every(
        (entry) =>
          typeof entry === "string" &&
          !entry.startsWith("*.") &&
          entry.length <= 253,
      )
    ) {
      writableDomains = parsed;
    }
  } catch {
    // Invalid/corrupt write scope is read-only, never a broader fallback.
  }
  try {
    const parsed = irreversibleActionScopeSchema
      .array()
      .max(20)
      .safeParse(JSON.parse(row.irreversible_action_scopes_json));
    if (parsed.success) irreversibleActionScopes = parsed.data;
  } catch {
    // Corrupt irreversible scopes are never treated as authority.
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    allowedDomains,
    writableDomains,
    testDataAttested: row.test_data_attested === 1,
    irreversibleActionScopes,
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

const MAX_IDS_PER_QUERY = 90;

export class D1BrowserTestRepo implements BrowserTestRepo {
  constructor(private readonly database: D1Database) {}

  async insert(test: BrowserTest): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO browser_tests
            (id, workspace_id, name, allowed_domains_json,
             writable_domains_json, allow_reversible_writes,
             test_data_attested, irreversible_action_scopes_json,
             start_url, instructions, device,
             interval_hours, max_retries, notify_on_recovery, next_run_at,
             created_by, updated_by, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          test.id,
          test.workspaceId,
          test.name,
          JSON.stringify(test.allowedDomains ?? []),
          JSON.stringify(test.writableDomains ?? []),
          test.testDataAttested ? 1 : 0,
          JSON.stringify(test.irreversibleActionScopes ?? []),
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

  async findByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<BrowserTest[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await all<BrowserTestRow>(
      this.database
        .prepare(
          `SELECT * FROM browser_tests
           WHERE workspace_id = ? AND deleted_at IS NULL
             AND id IN (${placeholders})`,
        )
        .bind(workspaceId, ...ids),
    );
    return rows.map(toBrowserTest);
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

  async listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<BrowserTest[]> {
    const values: (string | number)[] = [workspaceId];
    const cursorClause =
      cursor === null || cursor === undefined
        ? ""
        : "AND (created_at < ? OR (created_at = ? AND id < ?))";
    if (cursor !== null && cursor !== undefined) {
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    values.push(limit);
    return (
      await all<BrowserTestRow>(
        this.database
          .prepare(
            `SELECT * FROM browser_tests
             WHERE workspace_id = ? AND deleted_at IS NULL ${cursorClause}
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .bind(...values),
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
    if (changes.allowedDomains !== undefined) {
      add("allowed_domains_json", JSON.stringify(changes.allowedDomains));
    }
    if (changes.writableDomains !== undefined) {
      add("writable_domains_json", JSON.stringify(changes.writableDomains));
      // The version-1 global flag is retained only for schema compatibility;
      // clearing it prevents any older reader from treating it as authority.
      add("allow_reversible_writes", 0);
    }
    if (changes.testDataAttested !== undefined) {
      add("test_data_attested", changes.testDataAttested ? 1 : 0);
    }
    if (changes.irreversibleActionScopes !== undefined) {
      add(
        "irreversible_action_scopes_json",
        JSON.stringify(changes.irreversibleActionScopes),
      );
    }
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

  async getChannelIdsForTests(
    workspaceId: string,
    testIds: string[],
  ): Promise<Map<string, string[]>> {
    const uniqueIds = [...new Set(testIds)];
    const result = new Map(uniqueIds.map((testId) => [testId, [] as string[]]));
    if (uniqueIds.length === 0) return result;
    const chunks = Array.from(
      { length: Math.ceil(uniqueIds.length / MAX_IDS_PER_QUERY) },
      (_, index) =>
        uniqueIds.slice(
          index * MAX_IDS_PER_QUERY,
          (index + 1) * MAX_IDS_PER_QUERY,
        ),
    );
    const rows = (
      await Promise.all(
        chunks.map(async (ids) => {
          const placeholders = ids.map(() => "?").join(", ");
          return all<{
            browser_test_id: string;
            notification_channel_id: string;
          }>(
            this.database
              .prepare(
                `SELECT links.browser_test_id, links.notification_channel_id
                 FROM browser_test_channels AS links
                 INNER JOIN browser_tests AS tests
                   ON tests.id = links.browser_test_id
                 WHERE tests.workspace_id = ? AND tests.deleted_at IS NULL
                   AND links.browser_test_id IN (${placeholders})
                 ORDER BY links.browser_test_id ASC,
                          links.notification_channel_id ASC`,
              )
              .bind(workspaceId, ...ids),
          );
        }),
      )
    ).flat();
    for (const row of rows) {
      result.get(row.browser_test_id)?.push(row.notification_channel_id);
    }
    return result;
  }
}
