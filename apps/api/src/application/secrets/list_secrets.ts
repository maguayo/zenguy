import type { SecretRepo } from "../../domain/secrets/repo";
import type { UserRepo } from "../../domain/users/repo";
import { secretOutput, type SecretOutput } from "./types";

export class ListSecrets {
  constructor(
    private readonly secrets: SecretRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: { workspaceId: string }): Promise<SecretOutput[]> {
    return Promise.all(
      (await this.secrets.list(input.workspaceId)).map(async (secret) => {
        const creator =
          secret.createdBy === null
            ? null
            : await this.users.findById(secret.createdBy);
        return secretOutput(secret, creator);
      }),
    );
  }
}
