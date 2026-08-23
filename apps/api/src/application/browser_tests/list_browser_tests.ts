import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { UserRepo } from "../../domain/users/repo";
import { validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";
import { browserTestOutput, type BrowserTestOutput } from "./types";

/** Ticks shown in the list's history strip. */
const RECENT_RUNS = 20;
export const MAX_BROWSER_TEST_LIST_PAGE = 100;

export interface BrowserTestPage {
  tests: BrowserTestOutput[];
  nextCursor: string | null;
}

export class ListBrowserTests {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    cursor?: string;
    limit?: number;
  }): Promise<BrowserTestPage> {
    const limit = input.limit ?? MAX_BROWSER_TEST_LIST_PAGE;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_BROWSER_TEST_LIST_PAGE
    ) {
      throw validation([
        {
          field: "limit",
          message: `Must be an integer between 1 and ${MAX_BROWSER_TEST_LIST_PAGE}`,
        },
      ]);
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.tests.listPage(
      input.workspaceId,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const testIds = page.map((test) => test.id);
    const creatorIds = page.flatMap((test) =>
      test.createdBy === null ? [] : [test.createdBy],
    );
    const [channelIds, creators, summaries, recentRuns] = await Promise.all([
      this.tests.getChannelIdsForTests(input.workspaceId, testIds),
      this.users.findByIds(creatorIds),
      this.runs.lastRunSummaryPerTest(input.workspaceId, testIds),
      this.runs.recentRunsPerTest(input.workspaceId, RECENT_RUNS, testIds),
    ]);
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]));
    const last = page.at(-1);
    return {
      tests: page.map((test) =>
        browserTestOutput(
          test,
          channelIds.get(test.id) ?? [],
          test.createdBy === null
            ? null
            : (creatorsById.get(test.createdBy) ?? null),
          summaries.get(test.id) ?? null,
          recentRuns.get(test.id) ?? [],
        ),
      ),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
