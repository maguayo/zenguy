import type { WorkspaceApiKey } from "./types";

export interface ApiKeyRepo {
  insert(apiKey: WorkspaceApiKey): Promise<void>;
  findById(workspaceId: string, id: string): Promise<WorkspaceApiKey | null>;
  findByHash(keyHash: string): Promise<WorkspaceApiKey | null>;
  list(workspaceId: string): Promise<WorkspaceApiKey[]>;
  countActive(workspaceId: string, now: number): Promise<number>;
  revoke(id: string, at: number): Promise<void>;
  revokeAllCreatedBy(
    workspaceId: string,
    creatorUserId: string,
    at: number,
  ): Promise<number>;
  touchLastUsed(id: string, at: number): Promise<void>;
}
