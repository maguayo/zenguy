import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { Secret } from "./types";

export interface CreateSecretInput {
  allowedDomains: string[];
  description?: string;
  key: string;
  value: string;
}

export interface ReplaceSecretInput {
  allowedDomains?: string[];
  description?: string | null;
  value?: string;
}

function secretsPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/secrets`;
}

export function secretPath(workspaceId: string, secretId: string): string {
  return `${secretsPath(workspaceId)}/${encodeURIComponent(secretId)}`;
}

export function listSecrets(workspaceId: string): Promise<Secret[]> {
  return apiGet(secretsPath(workspaceId));
}

export function createSecret(
  workspaceId: string,
  input: CreateSecretInput,
): Promise<Secret> {
  return apiPost(secretsPath(workspaceId), input);
}

export function replaceSecret(
  workspaceId: string,
  secretId: string,
  input: ReplaceSecretInput,
): Promise<Secret> {
  return apiPut(secretPath(workspaceId, secretId), input);
}

export function deleteSecret(workspaceId: string, secretId: string): Promise<void> {
  return apiDelete(secretPath(workspaceId, secretId));
}
