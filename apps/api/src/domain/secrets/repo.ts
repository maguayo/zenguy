import type { SecretMetaUpdate, WorkspaceSecret } from "./types";
import type { Cursor } from "../../shared/pagination";

export interface SecretRepo {
  insert(secret: WorkspaceSecret): Promise<void>;
  findByKey(workspaceId: string, key: string): Promise<WorkspaceSecret | null>;
  findById(workspaceId: string, id: string): Promise<WorkspaceSecret | null>;
  list(workspaceId: string): Promise<WorkspaceSecret[]>;
  listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<WorkspaceSecret[]>;
  updateValue(
    id: string,
    encryptedValue: string,
    encryptionVersion: number,
    at: number,
  ): Promise<void>;
  updateMeta(id: string, changes: SecretMetaUpdate, at: number): Promise<void>;
  delete(id: string): Promise<void>;
  getManyByKeys(
    workspaceId: string,
    keys: string[],
  ): Promise<WorkspaceSecret[]>;
}
