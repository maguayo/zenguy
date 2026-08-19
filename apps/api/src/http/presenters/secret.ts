import type { SecretOutput } from "../../application/secrets/types";

export function presentSecret(secret: SecretOutput) {
  return {
    ...secret,
    createdAt: new Date(secret.createdAt).toISOString(),
    updatedAt: new Date(secret.updatedAt).toISOString(),
  };
}
