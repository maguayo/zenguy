import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakeUsageEventRepo } from "../../test/fakes/repos";
import { RecordRunUsage } from "./record_run_usage";
import { ReverseRunUsage } from "./reverse_run_usage";

describe("run usage recording", () => {
  it("returns the same event id when a run is recorded twice", async () => {
    const usageEvents = new FakeUsageEventRepo();
    const clock = new FixedClock(2_000);
    const record = new RecordRunUsage(usageEvents, clock, new FakeIds());

    const first = await record.execute({
      workspaceId: "ws_primary",
      runId: "run_primary",
      occurredAt: 1_500,
    });
    clock.advance(100);
    const second = await record.execute({
      workspaceId: "ws_primary",
      runId: "run_primary",
      occurredAt: 1_600,
    });

    expect(second).toBe(first);
    expect(usageEvents.events.size).toBe(1);
    expect([...usageEvents.events.values()][0]).toEqual({
      id: first,
      workspaceId: "ws_primary",
      testRunId: "run_primary",
      type: "BROWSER_RUN",
      quantity: 1,
      billable: true,
      idempotencyKey: "run:run_primary",
      occurredAt: 1_500,
      reversedAt: null,
      createdAt: 2_000,
    });
  });

  it("reverses a run idempotently at the current time", async () => {
    const usageEvents = new FakeUsageEventRepo();
    const clock = new FixedClock(2_000);
    const record = new RecordRunUsage(usageEvents, clock, new FakeIds());
    const reverse = new ReverseRunUsage(usageEvents, clock);
    const id = await record.execute({
      workspaceId: "ws_primary",
      runId: "run_primary",
      occurredAt: 1_500,
    });
    clock.advance(500);

    await reverse.execute({ runId: "run_primary" });
    clock.advance(500);
    await reverse.execute({ runId: "run_primary" });

    expect(usageEvents.events.get(id)?.reversedAt).toBe(2_500);
    await expect(
      usageEvents.countBillable("ws_primary", 1_000, 3_000),
    ).resolves.toBe(0);
  });
});
