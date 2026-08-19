import type { SecretRepo } from "../../domain/secrets/repo";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import { decryptSecret } from "../../shared/crypto";
import { Redactor } from "../../shared/redact";

export type { ResolvedSecrets } from "../../domain/secrets/types";

export class ResolveSecrets {
  constructor(
    private readonly secrets: SecretRepo,
    private readonly encryptionKey: Uint8Array,
  ) {}

  async execute(input: {
    workspaceId: string;
    referencedKeys: string[];
  }): Promise<ResolvedSecrets> {
    const keys = [...new Set(input.referencedKeys)];
    const stored = await this.secrets.getManyByKeys(input.workspaceId, keys);
    const resolved: ResolvedSecrets = new Map();
    for (const secret of stored) {
      if (secret.encryptionVersion !== 1) {
        throw new Error("Unsupported secret encryption version");
      }
      resolved.set(secret.key, {
        value: await decryptSecret(secret.encryptedValue, this.encryptionKey),
        allowedDomains: [...secret.allowedDomains],
      });
    }
    return resolved;
  }
}

export function buildRedactor(secrets: ResolvedSecrets): Redactor {
  return new Redactor(
    [...secrets].map(([key, secret]) => ({ key, value: secret.value })),
  );
}
