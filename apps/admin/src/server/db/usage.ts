import type { UsageCollection, UsageProbeResult } from "../../shared/types";

export interface UsageRow {
  day: string;
  metric: string;
  value: number;
}

// D1 batches are capped well above this; small chunks keep each statement
// list comfortably inside the request size limit.
const BATCH_SIZE = 100;

const UPSERT_SQL = `
  INSERT INTO platform_usage_daily (day, metric, value, collected_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (day, metric) DO UPDATE SET
    value = excluded.value,
    collected_at = excluded.collected_at`;

/** Replaces each (day, metric) value: re-collecting a day is idempotent. */
export async function upsertUsage(
  db: D1Database,
  rows: readonly UsageRow[],
  collectedAt: number,
): Promise<void> {
  const statement = db.prepare(UPSERT_SQL);
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await db.batch(
      rows
        .slice(offset, offset + BATCH_SIZE)
        .map((row) => statement.bind(row.day, row.metric, row.value, collectedAt)),
    );
  }
}

export async function loadUsage(
  db: D1Database,
  fromDay: string,
  toDay: string,
): Promise<UsageRow[]> {
  const result = await db
    .prepare(
      `SELECT day, metric, value FROM platform_usage_daily
        WHERE day >= ? AND day <= ? ORDER BY day, metric`,
    )
    .bind(fromDay, toDay)
    .all<UsageRow>();
  return result.results;
}

interface CollectionRow {
  id: string;
  source: UsageCollection["source"];
  status: UsageCollection["status"];
  from_day: string;
  to_day: string;
  started_at: number;
  finished_at: number;
  details_json: string;
}

export async function recordCollection(
  db: D1Database,
  collection: UsageCollection,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO platform_usage_collections
         (id, source, status, from_day, to_day, started_at, finished_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      collection.id,
      collection.source,
      collection.status,
      collection.fromDay,
      collection.toDay,
      collection.startedAt,
      collection.finishedAt,
      JSON.stringify(collection.probes),
    )
    .run();
}

export async function latestCollection(db: D1Database): Promise<UsageCollection | null> {
  const row = await db
    .prepare(
      `SELECT id, source, status, from_day, to_day, started_at, finished_at, details_json
         FROM platform_usage_collections ORDER BY started_at DESC LIMIT 1`,
    )
    .first<CollectionRow>();
  if (row === null) return null;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    fromDay: row.from_day,
    toDay: row.to_day,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    probes: JSON.parse(row.details_json) as UsageProbeResult[],
  };
}
