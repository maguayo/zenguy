import type { RunSnapshot, TestRun } from "./types";

export interface RunFinalizedHandler {
  handle(run: TestRun, snapshot: RunSnapshot): Promise<void>;
}

export class NoopRunFinalizedHandler implements RunFinalizedHandler {
  async handle(_run: TestRun, _snapshot: RunSnapshot): Promise<void> {}
}
