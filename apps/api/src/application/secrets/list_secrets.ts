import type { SecretRepo } from "../../domain/secrets/repo";
import type { UserRepo } from "../../domain/users/repo";
import { secretOutput, type SecretOutput } from "./types";
import { validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";

export const MAX_SECRET_LIST_PAGE = 100;

export interface SecretPage {
  secrets: SecretOutput[];
  nextCursor: string | null;
}

export class ListSecrets {
  constructor(
    private readonly secrets: SecretRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    cursor?: string;
    limit?: number;
  }): Promise<SecretPage> {
    const limit = input.limit ?? MAX_SECRET_LIST_PAGE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SECRET_LIST_PAGE) {
      throw validation([
        {
          field: "limit",
          message: `Must be an integer between 1 and ${MAX_SECRET_LIST_PAGE}`,
        },
      ]);
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.secrets.listPage(
      input.workspaceId,
      cursor,
      limit + 1,
    );
    const secrets = rows.slice(0, limit);
    const creators = await this.users.findByIds(
      secrets.flatMap((secret) =>
        secret.createdBy === null ? [] : [secret.createdBy],
      ),
    );
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]));
    const last = secrets.at(-1);
    return {
      secrets: secrets.map((secret) =>
        secretOutput(
          secret,
          secret.createdBy === null
            ? null
            : (creatorsById.get(secret.createdBy) ?? null),
        ),
      ),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
