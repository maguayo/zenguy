import type { RunArtifact, RunSnapshot, TestRun } from "./types";

export interface RunFinalizedHandler {
  handle(run: TestRun, snapshot: RunSnapshot): Promise<void>;
}

export class NoopRunFinalizedHandler implements RunFinalizedHandler {
  async handle(_run: TestRun, _snapshot: RunSnapshot): Promise<void> {}
}

export interface ReportGenerator {
  generateForRun(run: TestRun): Promise<RunArtifact | null>;
}

export class NoopReportGenerator implements ReportGenerator {
  async generateForRun(_run: TestRun): Promise<null> {
    return null;
  }
}
