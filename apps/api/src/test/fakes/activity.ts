import type { TrackEventInput } from "../../application/activity/track_event";
import type { ActivityEventType } from "../../domain/activity/catalog";
import type { ActivityEventRepo } from "../../domain/activity/repo";
import type { ActivityEvent } from "../../domain/activity/types";

export class FakeActivityEventRepo implements ActivityEventRepo {
  readonly events: ActivityEvent[] = [];
  failNextInsert = false;

  async insert(event: ActivityEvent): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("D1 unavailable");
    }
    this.events.push(event);
  }

  async insertMany(events: ActivityEvent[]): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("D1 unavailable");
    }
    this.events.push(...events);
  }

  async deleteOlderThan(
    before: number,
    types: ActivityEventType[],
    limit: number,
  ): Promise<number> {
    const doomed = this.events
      .filter((event) => event.occurredAt < before && types.includes(event.type))
      .sort((left, right) => left.occurredAt - right.occurredAt)
      .slice(0, limit);
    for (const event of doomed) {
      this.events.splice(this.events.indexOf(event), 1);
    }
    return doomed.length;
  }

  async listRecent(limit: number): Promise<ActivityEvent[]> {
    return [...this.events]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, limit);
  }
}

/** Records every call; drop-in for `Pick<TrackEvent, "execute">`. */
export class FakeTrackEvent {
  readonly calls: TrackEventInput[] = [];

  async execute(input: TrackEventInput): Promise<void> {
    this.calls.push(input);
  }

  ofType(type: ActivityEventType): TrackEventInput[] {
    return this.calls.filter((call) => call.type === type);
  }
}
