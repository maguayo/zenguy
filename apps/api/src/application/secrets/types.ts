import type { User } from "../../domain/users/types";
import type { WorkspaceSecret } from "../../domain/secrets/types";

export interface SecretOutput {
  id: string;
  key: string;
  allowedDomains: string[];
  description: string | null;
  createdBy: { userId: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
}

export function secretOutput(
  secret: WorkspaceSecret,
  creator: User | null,
): SecretOutput {
  return {
    id: secret.id,
    key: secret.key,
    allowedDomains: [...secret.allowedDomains],
    description: secret.description,
    createdBy:
      creator === null ? null : { userId: creator.id, name: creator.name },
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}
