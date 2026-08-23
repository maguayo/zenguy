import { env } from "cloudflare:test";
import { planQueries } from "./analytics";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

/** The index 0024 added for exactly these scans. */
const RUNS_INDEX = "idx_test_runs_created_at";

interface PlanRow {
  detail: string;
}

async function planOf(sql: string, binds: unknown[]): Promise<string> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...binds)
    .all<PlanRow>();
  return results.map((row) => row.detail).join("\n");
}

/**
 * The date bound on test_runs is only honoured by idx_test_runs_created_at, and
 * two of these statements only stay on it because of a `GROUP BY +column` that
 * reads like a typo. Nothing else in the suite would notice it being removed:
 * the numbers would stay right and the query would walk the whole table.
 */
describe("analytics query plans", () => {
  it("keeps every bounded test_runs scan on the created_at index", async () => {
    for (const query of planQueries(NOW - 7 * DAY)) {
      const plan = await planOf(query.sql, query.binds);
      expect(plan, `${query.name}\n${plan}`).toContain(RUNS_INDEX);
    }
  });

  it("would not stay on it without the GROUP BY + hint", async () => {
    // The proof that the assertion above has teeth: the same two statements
    // with the unary plus removed leave the index behind.
    const grouped = planQueries(NOW - 7 * DAY).filter((query) => query.sql.includes("GROUP BY +"));
    expect(grouped).toHaveLength(2);
    for (const query of grouped) {
      const plan = await planOf(query.sql.replace("GROUP BY +", "GROUP BY "), query.binds);
      expect(plan, `${query.name}\n${plan}`).not.toContain(RUNS_INDEX);
    }
  });
});
