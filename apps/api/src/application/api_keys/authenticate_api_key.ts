import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { WorkspaceApiKey } from "../../domain/api_keys/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Workspace } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { API_KEY_PREFIX } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";

export interface AuthenticatedApiKey {
  apiKey: WorkspaceApiKey;
  workspace: Workspace;
}

// Every rejection uses the same error so callers cannot distinguish an
// unknown key from a revoked one or from a deleted workspace.
function invalidKey(): AppError {
  return new AppError("UNAUTHORIZED", "Invalid API key");
}

export class AuthenticateApiKey {
  constructor(
    private readonly apiKeys: ApiKeyRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: { key: string }): Promise<AuthenticatedApiKey> {
    if (!input.key.startsWith(API_KEY_PREFIX)) throw invalidKey();
    const apiKey = await this.apiKeys.findByHash(await sha256Hex(input.key));
    if (
      apiKey === null ||
      apiKey.revokedAt !== null ||
      apiKey.expiresAt <= this.clock.now() ||
      apiKey.scopes.length === 0
    ) {
      throw invalidKey();
    }
    const workspace = await this.workspaces.findById(apiKey.workspaceId);
    if (workspace === null || workspace.deletedAt !== null) throw invalidKey();

    return { apiKey, workspace };
  }
}
