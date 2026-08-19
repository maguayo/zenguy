import type { GetRun } from "../application/browser_tests/get_run";
import type { RunDetailOutput } from "../application/browser_tests/run_models";
import type { Clock } from "../shared/clock";
import { presentRun } from "./presenters/run";
import type { SseFrame } from "./sse";

const POLL_INTERVAL_MS = 2_000;
const PING_INTERVAL_MS = 15_000;
const MAX_STREAM_MS = 15 * 60_000;

type PresentedRun = ReturnType<typeof presentRun>;

function isTerminal(status: RunDetailOutput["status"]): boolean {
  return (
    status === "PASSED" ||
    status === "FAILED" ||
    status === "TIMEOUT" ||
    status === "SYSTEM_ERROR"
  );
}

function stableSignedUrl(value: string): string {
  try {
    const url = new URL(value, "https://sse.internal");
    if (url.pathname === "/api/artifact-content") {
      return `${url.pathname}?id=${url.searchParams.get("id") ?? ""}`;
    }
    if (url.pathname.endsWith("/events")) return url.pathname;
  } catch {
    // Leave unexpected URL-like values unchanged in the fingerprint.
  }
  return value;
}

function fingerprint(run: PresentedRun): string {
  return JSON.stringify(run, (key, value: unknown) =>
    key === "url" && typeof value === "string"
      ? stableSignedUrl(value)
      : value,
  );
}

export interface RunUpdateStreamDependencies {
  getRun: Pick<GetRun, "execute">;
  clock: Clock;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function* streamRunUpdates(
  input: { workspaceId: string; runId: string; initial?: RunDetailOutput },
  dependencies: RunUpdateStreamDependencies,
): AsyncGenerator<SseFrame> {
  const startedAt = dependencies.clock.now();
  const endsAt = startedAt + MAX_STREAM_MS;
  let nextPollAt = startedAt;
  let nextPingAt = startedAt + PING_INTERVAL_MS;
  let previousFingerprint: string | null = null;
  let initial = input.initial;
  const sleep = dependencies.sleep ?? defaultSleep;

  while (dependencies.clock.now() < endsAt) {
    let now = dependencies.clock.now();
    if (now >= nextPollAt) {
      const run =
        initial ??
        (await dependencies.getRun.execute({
          workspaceId: input.workspaceId,
          runId: input.runId,
        }));
      initial = undefined;
      nextPollAt = dependencies.clock.now() + POLL_INTERVAL_MS;
      const presented = presentRun(run);
      const currentFingerprint = fingerprint(presented);
      if (currentFingerprint !== previousFingerprint) {
        previousFingerprint = currentFingerprint;
        yield { event: "update", data: JSON.stringify(presented) };
      }
      if (isTerminal(run.status)) {
        yield { event: "done", data: "{}" };
        return;
      }
    }

    now = dependencies.clock.now();
    if (now >= nextPingAt) {
      yield { comment: "ping" };
      do {
        nextPingAt += PING_INTERVAL_MS;
      } while (nextPingAt <= dependencies.clock.now());
    }
    now = dependencies.clock.now();
    if (now >= endsAt) return;
    const wakeAt = Math.min(nextPollAt, nextPingAt, endsAt);
    await sleep(Math.max(0, wakeAt - now));
  }
}
