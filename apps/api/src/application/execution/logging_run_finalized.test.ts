import type { TestRun } from "../../domain/browser_tests/types";
import { LoggingRunFinalizedHandler } from "./logging_run_finalized";

describe("LoggingRunFinalizedHandler", () => {
  it("records a value-free handoff event until the incident engine replaces it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const run = {
      id: "run_finalized",
      status: "PASSED",
      snapshot: { name: "Checkout" },
    } as TestRun;

    await new LoggingRunFinalizedHandler().handle(run, run.snapshot);

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: "run_finalized_pending_incident_engine",
      runId: "run_finalized",
      status: "PASSED",
    });
    log.mockRestore();
  });
});
