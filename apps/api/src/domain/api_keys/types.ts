export const API_KEY_SCOPES = [
  "workspace:read",
  "uptime:read",
  "tests:read",
  "runs:read",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const DEFAULT_API_KEY_SCOPES: readonly ApiKeyScope[] = API_KEY_SCOPES;

export interface WorkspaceApiKey {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  expiresAt: number;
  createdBy: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}
