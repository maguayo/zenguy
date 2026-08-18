import { env } from "cloudflare:test";
import { all, batch, one, run } from "./d1";

interface TestRow {
  id: string;
  value: number;
}

describe("D1 helpers", () => {
  beforeEach(async () => {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS d1_helper_test (id TEXT PRIMARY KEY, value INTEGER NOT NULL)",
    );
    await env.DB.prepare("DELETE FROM d1_helper_test").run();
  });

  it("inserts and reads one or all rows", async () => {
    await run(
      env.DB.prepare(
        "INSERT INTO d1_helper_test (id, value) VALUES (?, ?)",
      ).bind("row-1", 42),
    );

    await expect(
      one<TestRow>(
        env.DB.prepare("SELECT id, value FROM d1_helper_test WHERE id = ?").bind(
          "row-1",
        ),
      ),
    ).resolves.toEqual({ id: "row-1", value: 42 });
    await expect(
      all<TestRow>(env.DB.prepare("SELECT id, value FROM d1_helper_test")),
    ).resolves.toEqual([{ id: "row-1", value: 42 }]);
  });

  it("returns null when one row is absent", async () => {
    await expect(
      one<TestRow>(
        env.DB.prepare("SELECT id, value FROM d1_helper_test WHERE id = ?").bind(
          "missing",
        ),
      ),
    ).resolves.toBeNull();
  });

  it("passes statement batches through to D1", async () => {
    const results = await batch<TestRow>(env.DB, [
      env.DB
        .prepare("INSERT INTO d1_helper_test (id, value) VALUES (?, ?)")
        .bind("row-1", 1),
      env.DB
        .prepare("INSERT INTO d1_helper_test (id, value) VALUES (?, ?)")
        .bind("row-2", 2),
    ]);

    expect(results).toHaveLength(2);
    await expect(
      all<TestRow>(
        env.DB.prepare("SELECT id, value FROM d1_helper_test ORDER BY id"),
      ),
    ).resolves.toEqual([
      { id: "row-1", value: 1 },
      { id: "row-2", value: 2 },
    ]);
  });
});
