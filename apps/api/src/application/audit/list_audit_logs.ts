import type { AuditAction } from "../../domain/audit/actions";
import type { AuditRepo } from "../../domain/audit/repo";
import type { UserRepo } from "../../domain/users/repo";
import { validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";

export interface AuditLogOutput {
  id: string;
  action: AuditAction;
  actor: { userId: string; name: string } | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: number;
}

export interface AuditLogPage {
  auditLogs: AuditLogOutput[];
  nextCursor: string | null;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class ListAuditLogs {
  constructor(
    private readonly audits: AuditRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    cursor?: string;
    limit?: number;
  }): Promise<AuditLogPage> {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validation([
        { field: "limit", message: "Must be an integer between 1 and 100" },
      ]);
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.audits.list(
      input.workspaceId,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const actorIds = [
      ...new Set(
        page.flatMap((entry) =>
          entry.actorUserId === null ? [] : [entry.actorUserId],
        ),
      ),
    ];
    const actorRows = await Promise.all(
      actorIds.map(async (id) => [id, await this.users.findById(id)] as const),
    );
    const actors = new Map(actorRows);
    const last = page.at(-1);
    return {
      auditLogs: page.map((entry) => {
        const actor =
          entry.actorUserId === null
            ? null
            : (actors.get(entry.actorUserId) ?? null);
        return {
          id: entry.id,
          action: entry.action,
          actor:
            actor === null
              ? null
              : { userId: actor.id, name: actor.name },
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          metadata: parseMetadata(entry.metadataJson),
          ip: entry.ip,
          createdAt: entry.createdAt,
        };
      }),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
