import { describe, expect, it, vi } from "vitest";

import { createActivityQueue } from "./queue";
import type { ClientEvent } from "./route-events";

const visit = (page: string, resourceId?: string): ClientEvent => ({
  type: resourceId ? "browser_test.viewed" : "web.page_viewed",
  workspaceId: "ws_1",
  ...(resourceId ? { resourceId } : {}),
  properties: { page },
});

function harness() {
  let time = 1_000;
  const timers: Array<{ fn: () => void; at: number }> = [];
  const sent: ClientEvent[][] = [];
  const queue = createActivityQueue({
    send: async (events) => { sent.push(events); },
    now: () => time,
    setTimer: (fn, ms) => { const handle = { fn, at: time + ms }; timers.push(handle); return handle; },
    clearTimer: (handle) => { const index = timers.indexOf(handle as never); if (index >= 0) timers.splice(index, 1); },
  });
  const advance = (ms: number) => {
    time += ms;
    for (const timer of [...timers]) if (timer.at <= time) { timers.splice(timers.indexOf(timer), 1); timer.fn(); }
  };
  return { queue, sent, advance, setTime: (value: number) => { time = value; } };
}

describe("activity queue", () => {
  it("debounces and sends one batch", () => {
    const { queue, sent, advance } = harness();
    queue.push(visit("/w/:wsId/overview"));
    queue.push(visit("/w/:wsId/tests"));
    expect(sent).toEqual([]);
    advance(999);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toEqual([[visit("/w/:wsId/overview"), visit("/w/:wsId/tests")]]);
  });

  it("drops a repeat of the same visit inside the dedupe window", () => {
    const { queue, sent, advance } = harness();
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    advance(1_000);
    expect(sent[0]).toHaveLength(1);
    advance(29_000);
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    advance(1_000);
    expect(sent).toHaveLength(1);
    advance(1_000);
    queue.push(visit("/w/:wsId/tests/:testId", "bt_1"));
    advance(1_000);
    expect(sent).toHaveLength(2);
  });

  it("flushes immediately when the batch is full, on flush(), and discards on clear()", () => {
    const { queue, sent, advance } = harness();
    for (let index = 0; index < 25; index += 1) queue.push(visit(`/p${index}`));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(25);
    queue.push(visit("/late"));
    queue.flush();
    expect(sent).toHaveLength(2);
    queue.push(visit("/never"));
    queue.clear();
    advance(5_000);
    expect(sent).toHaveLength(2);
    expect(queue.size()).toBe(0);
  });

  it("swallows transport failures", async () => {
    const send = vi.fn(async () => { throw new Error("offline"); });
    const queue = createActivityQueue({ send, now: () => 0, setTimer: (fn) => { fn(); return 0; }, clearTimer: () => undefined });
    expect(() => queue.push(visit("/x"))).not.toThrow();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
