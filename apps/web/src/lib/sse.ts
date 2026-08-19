import type { Run } from "../api/types";

export interface EventSourceLike {
  addEventListener: (type: string, listener: EventListener) => void;
  close: () => void;
}

export interface RunSubscriptionOptions {
  createEventSource?: (url: string) => EventSourceLike;
  onDone?: () => void;
  onError?: () => void;
}

export function subscribeRun(
  liveUrl: string,
  onUpdate: (run: Run) => void,
  {
    createEventSource = (url) => new EventSource(url) as unknown as EventSourceLike,
    onDone,
    onError,
  }: RunSubscriptionOptions = {},
): () => void {
  const source = createEventSource(liveUrl);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  source.addEventListener(
    "update",
    ((event: MessageEvent<string>) => {
      try {
        onUpdate(JSON.parse(event.data) as Run);
      } catch {
        close();
        onError?.();
      }
    }) as EventListener,
  );
  source.addEventListener(
    "done",
    (() => {
      close();
      onDone?.();
    }) as EventListener,
  );
  source.addEventListener(
    "error",
    (() => {
      close();
      onError?.();
    }) as EventListener,
  );

  return close;
}
