import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { UserRepo } from "../../domain/users/repo";
import { notFound } from "../../shared/errors";
import { browserTestOutput, type BrowserTestOutput } from "./types";

export class GetBrowserTest {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    testId: string;
  }): Promise<BrowserTestOutput> {
    const test = await this.tests.findById(input.workspaceId, input.testId);
    if (test === null) throw notFound("Browser test");
    const [channelIds, summaries, creator] = await Promise.all([
      this.tests.getChannelIds(test.id),
      this.runs.lastRunSummaryPerTest(input.workspaceId),
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
  }
}
