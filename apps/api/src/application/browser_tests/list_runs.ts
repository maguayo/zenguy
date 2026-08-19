import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { RunStatus } from "../../domain/browser_tests/types";
import type { UserRepo } from "../../domain/users/repo";
import { notFound, validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";
import type { RunListItemOutput, UserRefOutput } from "./run_models";

export interface RunPage {
  runs: RunListItemOutput[];
  nextCursor: string | null;
}

export class ListRuns {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    testId: string;
    cursor?: string;
    limit?: number;
    status?: RunStatus;
  }): Promise<RunPage> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validation([
        { field: "limit", message: "Must be an integer between 1 and 100" },
      ]);
    }
    if ((await this.tests.findById(input.workspaceId, input.testId)) === null) {
      throw notFound("Browser test");
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.runs.listForTest(
      input.testId,
      cursor,
      limit + 1,
      input.status,
    );
    const page = rows.slice(0, limit);
    const users = new Map<string, UserRefOutput>();
    await Promise.all(
      [...new Set(page.flatMap((run) =>
        run.triggeredByUserId === null ? [] : [run.triggeredByUserId],
      ))].map(async (userId) => {
        const user = await this.users.findById(userId);
        users.set(
          userId,
          user === null ? null : { userId: user.id, name: user.name },
        );
      }),
    );
    const last = page.at(-1);
    return {
      runs: page.map((run) => ({
        id: run.id,
        createdAt: run.createdAt,
        source: run.source,
        status: run.status,
        durationMs: run.durationMs,
        device: run.snapshot.device,
        attemptCount: run.attemptCount,
        passedAfterRetry: run.passedAfterRetry,
        billable: run.billable,
        triggeredBy:
          run.triggeredByUserId === null
            ? null
            : (users.get(run.triggeredByUserId) ?? null),
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
