import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { SecretRepo } from "../../domain/secrets/repo";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import {
  SECRET_KEY_REGEX,
  validateAllowedDomains,
} from "../../domain/secrets/rules";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import {
  CURRENT_ENCRYPTION_VERSION,
  encryptSecret,
  type EncryptionKeyring,
} from "../../shared/crypto";
import {
  conflict,
  forbidden,
  throwIfCollectionCap,
  validation,
} from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { writeWithActiveDataKeyRetry } from "../security/write_with_active_data_key";
import { secretOutput, type SecretOutput } from "./types";

export class CreateSecret {
  constructor(
    private readonly secrets: SecretRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKeys: EncryptionKeyring,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    key: string;
    value: string;
    allowedDomains: string[];
    description?: string;
    ip?: string;
  }): Promise<SecretOutput> {
    if (!can(input.actorRole, "secrets.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    if (!SECRET_KEY_REGEX.test(input.key)) {
      throw validation([
        { field: "key", message: "Use 2–64 uppercase letters, numbers, or underscores" },
      ]);
    }
    if (input.value.length < 1 || input.value.length > 4_096) {
      throw validation([
        { field: "value", message: "Value must be between 1 and 4096 characters" },
      ]);
    }
    validateAllowedDomains(input.allowedDomains);
    if ((await this.secrets.findByKey(input.workspaceId, input.key)) !== null) {
      throw conflict("A secret with this key already exists");
    }

    const now = this.clock.now();
    const secretId = this.ids.newId("sec");
    let secret: WorkspaceSecret;
    try {
      secret = await writeWithActiveDataKeyRetry(
        async () => ({
          id: secretId,
          workspaceId: input.workspaceId,
          key: input.key,
          encryptedValue: await encryptSecret(input.value, this.encryptionKeys, {
            type: "workspace_secret",
            workspaceId: input.workspaceId,
            recordId: secretId,
          }),
          encryptionVersion: CURRENT_ENCRYPTION_VERSION,
          allowedDomains: [...input.allowedDomains],
          description: input.description ?? null,
          createdBy: input.actor.id,
          createdAt: now,
          updatedAt: now,
        }),
        (candidate) => this.secrets.insert(candidate),
      );
    } catch (error) {
      throwIfCollectionCap(error);
      if (
        (await this.secrets.findByKey(input.workspaceId, input.key)) !== null
      ) {
        throw conflict("A secret with this key already exists");
      }
      throw error;
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.secretCreated,
      resourceType: "secret",
      resourceId: secret.id,
      metadata: { key: secret.key, domains: secret.allowedDomains },
      ip: input.ip,
    });
    return secretOutput(secret, input.actor);
  }
}
