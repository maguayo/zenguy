export interface WorkspaceApiKey {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  createdBy: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}
