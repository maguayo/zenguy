export interface WorkspaceSecret {
  id: string;
  workspaceId: string;
  key: string;
  encryptedValue: string;
  encryptionVersion: number;
  allowedDomains: string[];
  description: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SecretMetaUpdate {
  allowedDomains?: string[];
  description?: string | null;
}
