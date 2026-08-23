import type { BrowserTestOutput } from "../../application/browser_tests/types";

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function presentBrowserTest(test: BrowserTestOutput) {
  return {
    ...test,
    nextRunAt: new Date(test.nextRunAt).toISOString(),
    createdAt: new Date(test.createdAt).toISOString(),
    updatedAt: new Date(test.updatedAt).toISOString(),
    recentRuns: test.recentRuns.map((tick) => ({
      ...tick,
      finishedAt: iso(tick.finishedAt),
    })),
    lastRun:
      test.lastRun === null
        ? null
        : {
            ...test.lastRun,
            startedAt: iso(test.lastRun.startedAt),
            finishedAt: iso(test.lastRun.finishedAt),
            createdAt: new Date(test.lastRun.createdAt).toISOString(),
          },
  };
}
