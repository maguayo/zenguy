import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { UserRepo } from "../../domain/users/repo";
import { apiKeyOutput, type ApiKeyOutput } from "./types";

export class ListApiKeys {
  constructor(
    private readonly apiKeys: ApiKeyRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: { workspaceId: string }): Promise<ApiKeyOutput[]> {
    const keys = await this.apiKeys.list(input.workspaceId);
    return Promise.all(
      keys
        .filter((apiKey) => apiKey.revokedAt === null)
        .map(async (apiKey) => {
          const creator =
            apiKey.createdBy === null
              ? null
              : await this.users.findById(apiKey.createdBy);
          return apiKeyOutput(apiKey, creator);
        }),
    );
  }
}
