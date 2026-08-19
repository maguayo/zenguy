import type { RunSnapshot } from "../../domain/browser_tests/types";
import { extractPlaceholders } from "../../domain/secrets/rules";
import { Redactor } from "../../shared/redact";
import {
  buildRedactor,
  type ResolveSecrets,
} from "../secrets/resolve_secrets";

export type RunSecretResolver = Pick<ResolveSecrets, "execute">;

export async function runOutputRedactor(
  workspaceId: string,
  snapshot: RunSnapshot,
  resolver: RunSecretResolver | undefined,
): Promise<Redactor> {
  if (resolver === undefined) return new Redactor([]);
  const referencedKeys = extractPlaceholders(JSON.stringify(snapshot));
  if (referencedKeys.length === 0) return new Redactor([]);
  return buildRedactor(
    await resolver.execute({ workspaceId, referencedKeys }),
  );
}
