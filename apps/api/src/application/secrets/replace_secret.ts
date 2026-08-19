import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { SecretRepo } from "../../domain/secrets/repo";
import { validateAllowedDomains } from "../../domain/secrets/rules";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { UserRepo } from "../../domain/users/repo";
import type { Clock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import { forbidden, notFound, validation } from "../../shared/errors";
import { secretOutput, type SecretOutput } from "./types";

export class ReplaceSecret {
  constructor(
    private readonly secrets: SecretRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly users: UserRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    secretId: string;
    actor: User;
    actorRole: Role;
    value?: string;
    allowedDomains?: string[];
    description?: string | null;
    ip?: string;
  }): Promise<SecretOutput> {
    if (!can(input.actorRole, "secrets.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    if (
      input.value === undefined &&
      input.allowedDomains === undefined &&
      input.description === undefined
    ) {
      throw validation([
        { field: "body", message: "At least one field is required" },
      ]);
    }
    if (
      input.value !== undefined &&
      (input.value.length < 1 || input.value.length > 4_096)
    ) {
      throw validation([
        { field: "value", message: "Value must be between 1 and 4096 characters" },
      ]);
    }
    if (input.allowedDomains !== undefined) {
      validateAllowedDomains(input.allowedDomains);
    }
    const secret = await this.secrets.findById(
      input.workspaceId,
      input.secretId,
    );
    if (secret === null) throw notFound("Secret");

    const now = this.clock.now();
    const changedFields: string[] = [];
    let encryptedValue = secret.encryptedValue;
    if (input.value !== undefined) {
      encryptedValue = await encryptSecret(input.value, this.encryptionKey);
      await this.secrets.updateValue(secret.id, encryptedValue, now);
      changedFields.push("value");
    }
    if (
      input.allowedDomains !== undefined ||
      input.description !== undefined
    ) {
      await this.secrets.updateMeta(
        secret.id,
        {
          ...(input.allowedDomains === undefined
            ? {}
            : { allowedDomains: input.allowedDomains }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
        },
        now,
      );
      if (input.allowedDomains !== undefined) changedFields.push("allowedDomains");
      if (input.description !== undefined) changedFields.push("description");
    }
    const updated = {
      ...secret,
      encryptedValue,
      ...(input.allowedDomains === undefined
        ? {}
        : { allowedDomains: [...input.allowedDomains] }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      updatedAt: now,
    };
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.secretUpdated,
      resourceType: "secret",
      resourceId: secret.id,
      metadata: { key: secret.key, changedFields },
      ip: input.ip,
    });
    const creator =
      updated.createdBy === null
        ? null
        : await this.users.findById(updated.createdBy);
    return secretOutput(updated, creator);
  }
}
