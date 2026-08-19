import type { RunFinalizedHandler } from "../../domain/browser_tests/ports";
import type {
  RunSnapshot,
  TestRun,
} from "../../domain/browser_tests/types";
import { logEvent } from "../../shared/log";

export class LoggingRunFinalizedHandler implements RunFinalizedHandler {
  async handle(run: TestRun, _snapshot: RunSnapshot): Promise<void> {
    logEvent("run_finalized_pending_incident_engine", {
      runId: run.id,
      status: run.status,
    });
  }
}
