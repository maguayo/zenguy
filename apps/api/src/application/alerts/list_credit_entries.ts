import type { AlertRepo } from "../../domain/alerts/repo";
import type {
  AlertCreditEntry,
  AlertCreditEntryKind,
} from "../../domain/alerts/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import { forbidden, validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";

export interface CreditEntryOutput {
  id: string;
  kind: AlertCreditEntryKind;
  amountCents: number;
  balanceAfterCents: number;
  description: string;
  deliveryId: string | null;
  createdAt: number;
}

export interface CreditEntryPage {
  entries: CreditEntryOutput[];
  nextCursor: string | null;
}

export function creditEntryOutput(entry: AlertCreditEntry): CreditEntryOutput {
  return {
    id: entry.id,
    kind: entry.kind,
    amountCents: entry.amountCents,
    balanceAfterCents: entry.balanceAfterCents,
    description: entry.description,
    deliveryId: entry.deliveryId,
    createdAt: entry.createdAt,
  };
}

export class ListCreditEntries {
  constructor(private readonly alerts: Pick<AlertRepo, "listEntries">) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
    cursor?: string;
    limit?: number;
  }): Promise<CreditEntryPage> {
    if (!can(input.role, "billing.view")) throw forbidden();
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validation([
        { field: "limit", message: "Must be an integer between 1 and 100" },
      ]);
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.alerts.listEntries(
      input.workspaceId,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      entries: page.map(creditEntryOutput),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
