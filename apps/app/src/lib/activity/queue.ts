import type { ClientEvent } from "./screen-events";

export interface ActivityQueueOptions {
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
  const screen = event.properties.screen ?? "";
  return `${event.type}|${event.workspaceId ?? ""}|${event.resourceId ?? ""}|${String(screen)}`;
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
    void options.send(batch).catch(() => undefined);
  };

  return {
    push(event) {
      const key = dedupeKey(event);
      const at = now();
      const previous = lastSeen.get(key);
      if (previous !== undefined && at - previous <= dedupeWindowMs) return;
      lastSeen.set(key, at);
      pending.push(event);
      if (pending.length >= maxBatch) {
        flush();
        return;
      }
      if (timer === null) timer = setTimer(flush, debounceMs);
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
