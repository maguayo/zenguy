import type { ActivityEventType } from "./catalog";
import type { ActivityEvent } from "./types";

export interface ActivityEventRepo {
  insert(event: ActivityEvent): Promise<void>;
  /** One D1 batch; an empty list is a no-op. */
  insertMany(events: ActivityEvent[]): Promise<void>;
  /** Deletes up to `limit` rows of the given types older than `before`; returns the count. */
  deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number>;
  /** Newest first. Intended for tests and debugging, not for product features. */
  listRecent(limit: number): Promise<ActivityEvent[]>;
}
