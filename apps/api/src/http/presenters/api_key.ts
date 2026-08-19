import type { ApiKeyOutput } from "../../application/api_keys/types";

function iso(value: number): string {
  return new Date(value).toISOString();
}

export function presentApiKey(apiKey: ApiKeyOutput) {
  return {
    ...apiKey,
    createdAt: iso(apiKey.createdAt),
    lastUsedAt: apiKey.lastUsedAt === null ? null : iso(apiKey.lastUsedAt),
    revokedAt: apiKey.revokedAt === null ? null : iso(apiKey.revokedAt),
  };
}
