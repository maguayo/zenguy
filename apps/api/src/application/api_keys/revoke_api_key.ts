import type { WriteAudit } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";

// Deliberately not subscription-gated: a leaked key must be revocable even
// after the workspace subscription lapses.
export class RevokeApiKey {
  constructor(
    private readonly apiKeys: ApiKeyRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    apiKeyId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "api_keys.manage")) throw forbidden();
    const apiKey = await this.apiKeys.findById(
      input.workspaceId,
      input.apiKeyId,
    );
    if (apiKey === null) throw notFound("API key");
    if (apiKey.revokedAt !== null) return;

    await this.apiKeys.revoke(apiKey.id, this.clock.now());
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.apiKeyRevoked,
      resourceType: "api_key",
      resourceId: apiKey.id,
      metadata: { name: apiKey.name, keyPrefix: apiKey.keyPrefix },
      ip: input.ip,
    });
  }
}
