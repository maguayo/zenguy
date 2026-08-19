import type { CheckRepo, MonitorRepo } from "../../domain/uptime/repo";
import type { CheckStatus } from "../../domain/uptime/types";
import { notFound, validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";

export interface CheckListItemOutput {
  id: string;
  cycleId: string;
  attemptIndex: number;
  status: CheckStatus;
  httpStatus: number | null;
  responseTimeMs: number | null;
  failureReason: string | null;
  checkedAt: number;
}

export interface CheckPage {
  checks: CheckListItemOutput[];
  nextCursor: string | null;
}

export class ListChecks {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly checks: CheckRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    monitorId: string;
    cursor?: string;
    limit?: number;
  }): Promise<CheckPage> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validation([
        { field: "limit", message: "Must be an integer between 1 and 100" },
      ]);
    }
    if (
      (await this.monitors.findById(input.workspaceId, input.monitorId)) ===
      null
    ) {
      throw notFound("Uptime monitor");
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.checks.listForMonitor(
      input.monitorId,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      checks: page.map((check) => ({
        id: check.id,
        cycleId: check.cycleId,
        attemptIndex: check.attemptIndex,
        status: check.status,
        httpStatus: check.httpStatus,
        responseTimeMs: check.responseTimeMs,
        failureReason: check.failureReason,
        checkedAt: check.checkedAt,
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.checkedAt, last.id)
          : null,
    };
  }
}
