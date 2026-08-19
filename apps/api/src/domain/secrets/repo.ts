import type { SecretMetaUpdate, WorkspaceSecret } from "./types";

export interface SecretRepo {
  insert(secret: WorkspaceSecret): Promise<void>;
  findByKey(workspaceId: string, key: string): Promise<WorkspaceSecret | null>;
  findById(workspaceId: string, id: string): Promise<WorkspaceSecret | null>;
  list(workspaceId: string): Promise<WorkspaceSecret[]>;
  updateValue(id: string, encryptedValue: string, at: number): Promise<void>;
  updateMeta(id: string, changes: SecretMetaUpdate, at: number): Promise<void>;
  delete(id: string): Promise<void>;
  getManyByKeys(
    workspaceId: string,
    keys: string[],
  ): Promise<WorkspaceSecret[]>;
}
