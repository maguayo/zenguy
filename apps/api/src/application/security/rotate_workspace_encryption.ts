import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { EncryptionRotationRepo } from "../../domain/security/encryption";
import type { User } from "../../domain/users/types";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import {
  decryptSecret,
  encryptSecret,
  getActiveWorkspaceDataKey,
  rotateWorkspaceDataKey,
  type EncryptionKeyring,
} from "../../shared/crypto";
import { conflict, forbidden } from "../../shared/errors";
import type { WriteAudit } from "../audit/write_audit";

export interface RotateWorkspaceEncryptionResult {
  /** Active root/KEK id; retained for API compatibility and root operations. */
  activeKeyId: string;
  activeDataKeyId: string;
  dataKeyGeneration: number;
  dataKeyRotated: boolean;
  examined: number;
  rotated: number;
  conflicted: number;
  hasMore: boolean;
}

export class RotateWorkspaceEncryption {
  constructor(
    private readonly records: EncryptionRotationRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly keys: EncryptionKeyring,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    limit: number;
    rotateDataKeyFrom?: string;
    ip?: string;
  }): Promise<RotateWorkspaceEncryptionResult> {
    // This operation can decrypt every supported credential in a workspace.
    // Keep it at the owner boundary even though admins manage individual
    // secrets/channels/monitors.
    if (input.actorRole !== "OWNER") throw forbidden();
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new Error("Encryption rotation batch limit must be between 1 and 50");
    }

    let dataKey;
    try {
      dataKey =
        input.rotateDataKeyFrom === undefined
          ? await getActiveWorkspaceDataKey(this.keys, input.workspaceId)
          : await rotateWorkspaceDataKey(
              this.keys,
              input.workspaceId,
              input.rotateDataKeyFrom,
              this.clock.now(),
            );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Workspace data key changed")
      ) {
        throw conflict(error.message);
      }
      throw error;
    }

    const pending = await this.records.listPending(
      input.workspaceId,
      dataKey.id,
      input.limit + 1,
    );
    const targets = pending.slice(0, input.limit);
    if (targets.some((record) => record.workspaceId !== input.workspaceId)) {
      throw new Error("Encryption rotation repository crossed workspace boundary");
    }
    const replacements = await Promise.all(
      targets.map(async (record) => {
        const context = {
          type: record.type,
          workspaceId: record.workspaceId,
          recordId: record.recordId,
        };
        const plaintext = await decryptSecret(
          record.ciphertext,
          this.keys,
          context,
        );
        return {
          ...record,
          replacement: await encryptSecret(plaintext, this.keys, context),
        };
      }),
    );
    const replaced = await this.records.replaceIfUnchanged(
      replacements,
      this.clock.now(),
    );
    const rotated = replaced.filter(Boolean).length;
    const conflicted = replaced.length - rotated;
    // Re-read after all compare-and-swap writes. The D1 write fences guarantee
    // that a request which encrypted under a retired DEK cannot appear after
    // this sweep; if another explicit rotation won meanwhile, make the caller
    // continue under that newer active generation.
    const remaining = await this.records.listPending(
      input.workspaceId,
      dataKey.id,
      1,
    );
    const activeAfterSweep = await this.keys.workspaceDataKeys.findActive(
      input.workspaceId,
    );
    if (activeAfterSweep === null) {
      throw new Error("Workspace active data key disappeared during rotation");
    }
    const result = {
      activeKeyId: this.keys.active.id,
      activeDataKeyId: dataKey.id,
      dataKeyGeneration: dataKey.generation,
      dataKeyRotated: input.rotateDataKeyFrom !== undefined,
      examined: targets.length,
      rotated,
      conflicted,
      hasMore:
        remaining.length > 0 || activeAfterSweep.id !== dataKey.id,
    };
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.encryptionRotated,
      resourceType: "workspace_encryption",
      resourceId: input.workspaceId,
      metadata: result,
      ip: input.ip,
    });
    return result;
  }
}
