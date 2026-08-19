import {
  computeRunDuration,
  decideAfterAttempt,
  runStatusOnStart,
  shouldGenerateReport,
  shouldOpenIncident,
  shouldResolveIncident,
  type NextAction,
} from "./run_rules";
import type { RunStatus } from "./types";

const BASE = {
  maxRetries: 3,
  infraAttempts: 0,
  priorFunctionalStatuses: [],
  anyAttemptEverStarted: true,
} as const;

describe("decideAfterAttempt", () => {
  const cases: {
    name: string;
    input: Parameters<typeof decideAfterAttempt>[0];
    expected: NextAction;
  }[] = [
    {
      name: "26.1 passes on the first attempt",
      input: { ...BASE, attemptIndex: 0, attemptStatus: "PASSED" },
      expected: {
        kind: "finalize",
        runStatus: "PASSED",
        passedAfterRetry: false,
        reverseUsage: false,
      },
    },
    {
      name: "passes after a functional retry",
      input: { ...BASE, attemptIndex: 2, attemptStatus: "PASSED" },
      expected: {
        kind: "finalize",
        runStatus: "PASSED",
        passedAfterRetry: true,
        reverseUsage: false,
      },
    },
    {
      name: "retry 1 starts immediately",
      input: { ...BASE, attemptIndex: 0, attemptStatus: "FAILED" },
      expected: { kind: "retry", nextIndex: 1, delaySeconds: 0 },
    },
    {
      name: "retry 2 waits one minute",
      input: { ...BASE, attemptIndex: 1, attemptStatus: "FAILED" },
      expected: { kind: "retry", nextIndex: 2, delaySeconds: 60 },
    },
    {
      name: "retry 3 waits two minutes",
      input: { ...BASE, attemptIndex: 2, attemptStatus: "TIMEOUT" },
      expected: { kind: "retry", nextIndex: 3, delaySeconds: 120 },
    },
    {
      name: "26.3 preserves FAILED after retries are exhausted",
      input: { ...BASE, attemptIndex: 3, attemptStatus: "FAILED" },
      expected: {
        kind: "finalize",
        runStatus: "FAILED",
        passedAfterRetry: false,
        reverseUsage: false,
      },
    },
    {
      name: "preserves TIMEOUT instead of reclassifying it",
      input: {
        ...BASE,
        attemptIndex: 1,
        attemptStatus: "TIMEOUT",
        maxRetries: 1,
      },
      expected: {
        kind: "finalize",
        runStatus: "TIMEOUT",
        passedAfterRetry: false,
        reverseUsage: false,
      },
    },
    {
      name: "maxRetries zero finalizes the first failure",
      input: {
        ...BASE,
        attemptIndex: 0,
        attemptStatus: "FAILED",
        maxRetries: 0,
      },
      expected: {
        kind: "finalize",
        runStatus: "FAILED",
        passedAfterRetry: false,
        reverseUsage: false,
      },
    },
    {
      name: "system error uses the first infrastructure retry",
      input: { ...BASE, attemptIndex: 0, attemptStatus: "SYSTEM_ERROR" },
      expected: { kind: "infra_retry", delaySeconds: 30 },
    },
    {
      name: "system error uses the second infrastructure retry",
      input: {
        ...BASE,
        attemptIndex: 0,
        attemptStatus: "SYSTEM_ERROR",
        infraAttempts: 1,
      },
      expected: { kind: "infra_retry", delaySeconds: 30 },
    },
    {
      name: "last functional outcome outranks an exhausted infra failure",
      input: {
        ...BASE,
        attemptIndex: 2,
        attemptStatus: "SYSTEM_ERROR",
        infraAttempts: 2,
        priorFunctionalStatuses: ["FAILED", "TIMEOUT"],
      },
      expected: {
        kind: "finalize",
        runStatus: "TIMEOUT",
        passedAfterRetry: false,
        reverseUsage: false,
      },
    },
    {
      name: "system error before any start reverses usage",
      input: {
        ...BASE,
        attemptIndex: 0,
        attemptStatus: "SYSTEM_ERROR",
        infraAttempts: 2,
        anyAttemptEverStarted: false,
      },
      expected: {
        kind: "finalize",
        runStatus: "SYSTEM_ERROR",
        passedAfterRetry: false,
        reverseUsage: true,
      },
    },
    {
      name: "system error after a start remains billable",
      input: {
        ...BASE,
        attemptIndex: 0,
        attemptStatus: "SYSTEM_ERROR",
        infraAttempts: 2,
      },
      expected: {
        kind: "finalize",
        runStatus: "SYSTEM_ERROR",
        passedAfterRetry: false,
        reverseUsage: false,
      },
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(decideAfterAttempt(input)).toEqual(expected);
  });

  it("encodes the 26.2 fail, fail, pass sequence and delays", () => {
    const first = decideAfterAttempt({
      ...BASE,
      attemptIndex: 0,
      attemptStatus: "FAILED",
    });
    const second = decideAfterAttempt({
      ...BASE,
      attemptIndex: 1,
      attemptStatus: "FAILED",
    });
    const third = decideAfterAttempt({
      ...BASE,
      attemptIndex: 2,
      attemptStatus: "PASSED",
    });
    expect([first, second]).toEqual([
      { kind: "retry", nextIndex: 1, delaySeconds: 0 },
      { kind: "retry", nextIndex: 2, delaySeconds: 60 },
    ]);
    expect(third).toEqual({
      kind: "finalize",
      runStatus: "PASSED",
      passedAfterRetry: true,
      reverseUsage: false,
    });
  });

  it("encodes the 26.4 timeout then pass sequence", () => {
    expect(
      decideAfterAttempt({
        ...BASE,
        attemptIndex: 0,
        attemptStatus: "TIMEOUT",
      }),
    ).toEqual({ kind: "retry", nextIndex: 1, delaySeconds: 0 });
    expect(
      decideAfterAttempt({
        ...BASE,
        attemptIndex: 1,
        attemptStatus: "PASSED",
      }),
    ).toEqual({
      kind: "finalize",
      runStatus: "PASSED",
      passedAfterRetry: true,
      reverseUsage: false,
    });
  });
});

describe("run lifecycle predicates", () => {
  it("starts RUNNING and computes a non-negative queued duration", () => {
    expect(runStatusOnStart()).toBe("RUNNING");
    expect(computeRunDuration(1_000, 3_500)).toBe(2_500);
    expect(computeRunDuration(3_500, 1_000)).toBe(0);
  });

  it.each<[RunStatus, boolean]>([
    ["QUEUED", false],
    ["RUNNING", false],
    ["PASSED", false],
    ["FAILED", true],
    ["TIMEOUT", true],
    ["SYSTEM_ERROR", false],
  ])("generates reports only for %s = %s", (status, expected) => {
    expect(shouldGenerateReport(status)).toBe(expected);
  });

  it("opens incidents only for failed/timed-out saved-test runs", () => {
    expect(
      shouldOpenIncident({
        runStatus: "FAILED",
        source: "MANUAL",
        hasTest: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenIncident({
        runStatus: "TIMEOUT",
        source: "SCHEDULED",
        hasTest: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenIncident({
        runStatus: "FAILED",
        source: "VALIDATION",
        hasTest: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenIncident({
        runStatus: "FAILED",
        source: "MANUAL",
        hasTest: false,
      }),
    ).toBe(false);
    expect(
      shouldOpenIncident({
        runStatus: "SYSTEM_ERROR",
        source: "SCHEDULED",
        hasTest: true,
      }),
    ).toBe(false);
  });

  it.each<[RunStatus, boolean]>([
    ["QUEUED", false],
    ["RUNNING", false],
    ["PASSED", true],
    ["FAILED", false],
    ["TIMEOUT", false],
    ["SYSTEM_ERROR", false],
  ])("resolves incidents only for %s = %s", (status, expected) => {
    expect(shouldResolveIncident(status)).toBe(expected);
  });
});
