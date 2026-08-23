import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { UserRepo } from "../../domain/users/repo";
import { browserTestOutput, type BrowserTestOutput } from "./types";

/** Ticks shown in the list's history strip. */
const RECENT_RUNS = 20;

export class ListBrowserTests {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: { workspaceId: string }): Promise<BrowserTestOutput[]> {
    const [tests, summaries, recentRuns] = await Promise.all([
      this.tests.list(input.workspaceId),
      this.runs.lastRunSummaryPerTest(input.workspaceId),
      this.runs.recentRunsPerTest(input.workspaceId, RECENT_RUNS),
    ]);
    return Promise.all(
      tests.map(async (test) => {
        const [channelIds, creator] = await Promise.all([
          this.tests.getChannelIds(test.id),
          test.createdBy === null
            ? Promise.resolve(null)
            : this.users.findById(test.createdBy),
        ]);
        return browserTestOutput(
          test,
          channelIds,
          creator,
          summaries.get(test.id) ?? null,
          recentRuns.get(test.id) ?? [],
        );
      }),
    );
  }
}
