import type { User } from "../../domain/users/types";
import type { WorkspaceApiKey } from "../../domain/api_keys/types";

export interface ApiKeyOutput {
  id: string;
  name: string;
  keyPrefix: string;
  createdBy: { userId: string; name: string } | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export function apiKeyOutput(
  apiKey: WorkspaceApiKey,
  creator: User | null,
): ApiKeyOutput {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    createdBy:
      creator === null ? null : { userId: creator.id, name: creator.name },
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
  };
}
