import { describe, expect, it, vi } from "vitest";

import type { Run } from "../api/types";
import { subscribeRun, type EventSourceLike } from "./sse";

class FakeEventSource implements EventSourceLike {
  readonly close = vi.fn();
  private readonly listeners = new Map<string, EventListener[]>();

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data = "") {
    const event = { data } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("run SSE subscription", () => {
  it("forwards update payloads and closes on done", () => {
    const source = new FakeEventSource();
    const update = vi.fn<(run: Run) => void>();
    const done = vi.fn();
    subscribeRun("/signed/live-url", update, {
      createEventSource: () => source,
      onDone: done,
    });

    source.emit("update", JSON.stringify({ id: "run_1", status: "RUNNING" }));
    expect(update).toHaveBeenCalledWith({ id: "run_1", status: "RUNNING" });
    source.emit("done");
    expect(source.close).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });

  it("closes and triggers the polling fallback on connection or parse errors", () => {
    for (const eventType of ["error", "update"] as const) {
      const source = new FakeEventSource();
      const fallback = vi.fn();
      subscribeRun("/signed/live-url", vi.fn(), {
        createEventSource: () => source,
        onError: fallback,
      });

      source.emit(eventType, eventType === "update" ? "not-json" : "");
      expect(source.close).toHaveBeenCalledOnce();
      expect(fallback).toHaveBeenCalledOnce();
    }
  });
});
