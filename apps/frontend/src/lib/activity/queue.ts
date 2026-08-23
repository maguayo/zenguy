import type { ClientEvent } from "./route-events";

export interface ActivityQueueOptions {
  /** Transport for one batch. Failures never reach the caller of `push`. */
  send: (events: ClientEvent[]) => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;
  maxBatch?: number;
  dedupeWindowMs?: number;
}

export interface ActivityQueue {
  push(event: ClientEvent): void;
  flush(): void;
  clear(): void;
  size(): number;
}

function dedupeKey(event: ClientEvent): string {
  return `${event.type}|${event.workspaceId ?? ""}|${event.resourceId ?? ""}|${event.properties.page}`;
}

/** Batches client events: debounce, size cap, dedupe window, best-effort send. */
export function createActivityQueue(options: ActivityQueueOptions): ActivityQueue {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const debounceMs = options.debounceMs ?? 1_000;
  const maxBatch = options.maxBatch ?? 25;
  const dedupeWindowMs = options.dedupeWindowMs ?? 30_000;

  let pending: ClientEvent[] = [];
  let timer: unknown = null;
  const lastSeen = new Map<string, number>();

  const flush = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      void Promise.resolve(options.send(batch)).catch(() => undefined);
    } catch {
      // Best-effort delivery: a transport that throws synchronously is ignored too.
    }
  };

  return {
    push(event) {
      const key = dedupeKey(event);
      const at = now();
      const previous = lastSeen.get(key);
      // Inclusive window: a repeat exactly `dedupeWindowMs` after the last
      // accepted visit is still a duplicate. Dropped repeats do not extend it.
      if (previous !== undefined && at - previous <= dedupeWindowMs) return;
      lastSeen.set(key, at);
      pending.push(event);
      if (pending.length >= maxBatch) {
        flush();
        return;
      }
      if (timer === null) {
        const handle = setTimer(flush, debounceMs);
        // A timer that fired synchronously already flushed; keep no stale handle.
        if (pending.length > 0) timer = handle;
      }
    },
    flush,
    clear() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = [];
      lastSeen.clear();
    },
    size: () => pending.length,
  };
}
