import type {
  EncryptedRecord,
  EncryptionReplacement,
  EncryptionRotationRepo,
} from "../../domain/security/encryption";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import {
  createEncryptionKeyring,
  decryptSecret,
  encryptLegacySecretForMigration,
  encryptSecret,
  encryptV2SecretForMigration,
} from "../../shared/crypto";
import { RotateWorkspaceEncryption } from "./rotate_workspace_encryption";

const NOW = 1_700_000_000_000;
const ACTIVE_KEY = new Uint8Array(32).fill(9);
const PREVIOUS_KEY = new Uint8Array(32).fill(8);
const ACTIVE_ONLY = createEncryptionKeyring({
  id: "key-active",
  key: ACTIVE_KEY,
});
const PREVIOUS_ONLY = createEncryptionKeyring({
  id: "key-previous",
  key: PREVIOUS_KEY,
});
const KEYS = createEncryptionKeyring(
  ACTIVE_ONLY.active,
  [PREVIOUS_ONLY.active],
);
const OWNER: User = {
  id: "usr_owner",
  name: "Owner",
  email: "owner@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

class FakeRotationRepo implements EncryptionRotationRepo {
  readonly records = new Map<string, EncryptedRecord>();
  conflict = false;
  listPendingCalls = 0;

  private key(record: Pick<EncryptedRecord, "type" | "recordId">): string {
    return `${record.type}:${record.recordId}`;
  }

  add(record: EncryptedRecord): void {
    this.records.set(this.key(record), { ...record });
  }

  async listPending(
    workspaceId: string,
    activeDataKeyId: string,
    limit: number,
  ): Promise<EncryptedRecord[]> {
    this.listPendingCalls += 1;
    const prefix = `v4:${activeDataKeyId}:`;
    return [...this.records.values()]
      .filter(
        (record) =>
          record.workspaceId === workspaceId &&
          !record.ciphertext.startsWith(prefix),
      )
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async replaceIfUnchanged(
    replacements: readonly EncryptionReplacement[],
  ): Promise<boolean[]> {
    return replacements.map((replacement, index) => {
      if (this.conflict && index === 0) return false;
      const key = this.key(replacement);
      const current = this.records.get(key);
      if (current?.ciphertext !== replacement.ciphertext) return false;
      this.records.set(key, {
        type: replacement.type,
        workspaceId: replacement.workspaceId,
        recordId: replacement.recordId,
        ciphertext: replacement.replacement,
      });
      return true;
    });
  }
}

async function oldV2(
  plaintext: string,
  record: Omit<EncryptedRecord, "ciphertext">,
): Promise<EncryptedRecord> {
  return {
    ...record,
    ciphertext: await encryptV2SecretForMigration(plaintext, PREVIOUS_ONLY, {
      type: record.type,
      workspaceId: record.workspaceId,
      recordId: record.recordId,
    }),
  };
}

describe("RotateWorkspaceEncryption", () => {
  it("re-encrypts v1 and previous-key records for all supported record types", async () => {
    const records = new FakeRotationRepo();
    records.add({
      type: "workspace_secret",
      workspaceId: "ws_1",
      recordId: "sec_1",
      ciphertext: await encryptLegacySecretForMigration(
        "legacy-secret",
        PREVIOUS_KEY,
      ),
    });
    for (const record of [
      await oldV2("channel-config", {
        type: "notification_channel",
        workspaceId: "ws_1",
        recordId: "ch_1",
      }),
      await oldV2("headers", {
        type: "uptime_monitor_headers",
        workspaceId: "ws_1",
        recordId: "mon_1",
      }),
      await oldV2("body", {
        type: "uptime_monitor_body",
        workspaceId: "ws_1",
        recordId: "mon_1",
      }),
    ]) {
      records.add(record);
    }
    const audits: unknown[] = [];
    const rotate = new RotateWorkspaceEncryption(
      records,
      { execute: async (entry) => void audits.push(entry) },
      KEYS,
      new FixedClock(NOW),
    );

    await expect(
      rotate.execute({
        workspaceId: "ws_1",
        actor: OWNER,
        actorRole: "OWNER",
        limit: 50,
      }),
    ).resolves.toMatchObject({
      activeKeyId: "key-active",
      activeDataKeyId: expect.stringMatching(/^dek-[A-Za-z0-9_-]{24}$/u),
      dataKeyGeneration: 1,
      dataKeyRotated: false,
      examined: 4,
      rotated: 4,
      conflicted: 0,
      hasMore: false,
    });

    const expected = new Map([
      ["workspace_secret:sec_1", "legacy-secret"],
      ["notification_channel:ch_1", "channel-config"],
      ["uptime_monitor_headers:mon_1", "headers"],
      ["uptime_monitor_body:mon_1", "body"],
    ]);
    for (const [key, record] of records.records) {
      expect(record.ciphertext).toMatch(/^v4:dek-[A-Za-z0-9_-]{24}:/u);
      await expect(
        decryptSecret(record.ciphertext, KEYS, {
          type: record.type,
          workspaceId: record.workspaceId,
          recordId: record.recordId,
        }),
      ).resolves.toBe(expected.get(key));
    }
    expect(audits).toHaveLength(1);
    expect(records.listPendingCalls).toBe(2);
  });

  it("does not overwrite a concurrent write and asks the caller to continue", async () => {
    const records = new FakeRotationRepo();
    records.conflict = true;
    records.add(
      await oldV2("channel-config", {
        type: "notification_channel",
        workspaceId: "ws_1",
        recordId: "ch_1",
      }),
    );
    const rotate = new RotateWorkspaceEncryption(
      records,
      { execute: async () => undefined },
      KEYS,
      new FixedClock(NOW),
    );

    await expect(
      rotate.execute({
        workspaceId: "ws_1",
        actor: OWNER,
        actorRole: "OWNER",
        limit: 10,
      }),
    ).resolves.toMatchObject({ rotated: 0, conflicted: 1, hasMore: true });
  });

  it("keeps the operation owner-only", async () => {
    const rotate = new RotateWorkspaceEncryption(
      new FakeRotationRepo(),
      { execute: async () => undefined },
      KEYS,
      new FixedClock(NOW),
    );

    await expect(
      rotate.execute({
        workspaceId: "ws_1",
        actor: OWNER,
        actorRole: "ADMIN",
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rotates a DEK once under an optimistic precondition", async () => {
    const rotate = new RotateWorkspaceEncryption(
      new FakeRotationRepo(),
      { execute: async () => undefined },
      KEYS,
      new FixedClock(NOW),
    );
    const current = await rotate.execute({
      workspaceId: "ws_dek_rotation",
      actor: OWNER,
      actorRole: "OWNER",
      limit: 10,
    });
    const rotated = await rotate.execute({
      workspaceId: "ws_dek_rotation",
      actor: OWNER,
      actorRole: "OWNER",
      limit: 10,
      rotateDataKeyFrom: current.activeDataKeyId,
    });
    expect(rotated).toMatchObject({
      dataKeyGeneration: 2,
      dataKeyRotated: true,
      examined: 0,
    });
    expect(rotated.activeDataKeyId).not.toBe(current.activeDataKeyId);

    await expect(
      rotate.execute({
        workspaceId: "ws_dek_rotation",
        actor: OWNER,
        actorRole: "OWNER",
        limit: 10,
        rotateDataKeyFrom: current.activeDataKeyId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
