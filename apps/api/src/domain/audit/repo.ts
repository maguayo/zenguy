import type { Cursor } from "../../shared/pagination";
import type { AuditEntry } from "./types";

export interface AuditRepo {
  insert(entry: AuditEntry): Promise<void>;
  list(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AuditEntry[]>;
}
