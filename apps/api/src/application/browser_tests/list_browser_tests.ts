import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { UserRepo } from "../../domain/users/repo";
import { browserTestOutput, type BrowserTestOutput } from "./types";

export class ListBrowserTests {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: { workspaceId: string }): Promise<BrowserTestOutput[]> {
    const [tests, summaries] = await Promise.all([
      this.tests.list(input.workspaceId),
      this.runs.lastRunSummaryPerTest(input.workspaceId),
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
        );
      }),
    );
  }
}
