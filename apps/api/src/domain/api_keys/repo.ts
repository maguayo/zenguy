import type { WorkspaceApiKey } from "./types";

export interface ApiKeyRepo {
  insert(apiKey: WorkspaceApiKey): Promise<void>;
  findById(workspaceId: string, id: string): Promise<WorkspaceApiKey | null>;
  findByHash(keyHash: string): Promise<WorkspaceApiKey | null>;
  list(workspaceId: string): Promise<WorkspaceApiKey[]>;
  countActive(workspaceId: string): Promise<number>;
  revoke(id: string, at: number): Promise<void>;
  touchLastUsed(id: string, at: number): Promise<void>;
}
