import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  API_KEY_TOKEN_BYTES,
  MAX_ACTIVE_API_KEYS_PER_WORKSPACE,
} from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import { conflict, forbidden, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { apiKeyOutput, type ApiKeyOutput } from "./types";

export interface CreatedApiKey {
  apiKey: ApiKeyOutput;
  // Full plaintext key. Shown to the caller exactly once; only its hash is stored.
  key: string;
}

export class CreateApiKey {
  constructor(
    private readonly apiKeys: ApiKeyRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    name: string;
    ip?: string;
  }): Promise<CreatedApiKey> {
    if (!can(input.actorRole, "api_keys.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw validation([
        { field: "name", message: "Name must be between 1 and 80 characters" },
      ]);
    }
    const active = await this.apiKeys.countActive(input.workspaceId);
    if (active >= MAX_ACTIVE_API_KEYS_PER_WORKSPACE) {
      throw conflict(
        `A workspace can have at most ${MAX_ACTIVE_API_KEYS_PER_WORKSPACE} active API keys`,
      );
    }

    const key = `${API_KEY_PREFIX}${randomToken(API_KEY_TOKEN_BYTES)}`;
    const now = this.clock.now();
    const apiKey = {
      id: this.ids.newId("ak"),
      workspaceId: input.workspaceId,
      name,
      keyPrefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
      keyHash: await sha256Hex(key),
      createdBy: input.actor.id,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.apiKeys.insert(apiKey);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.apiKeyCreated,
      resourceType: "api_key",
      resourceId: apiKey.id,
      metadata: { name: apiKey.name, keyPrefix: apiKey.keyPrefix },
      ip: input.ip,
    });
    return { apiKey: apiKeyOutput(apiKey, input.actor), key };
  }
}
