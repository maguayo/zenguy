import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { loadConfig } from "../../shared/config";
import {
  createEncryptionKeyring,
  decryptSecret,
  encryptSecret,
  getActiveWorkspaceDataKey,
  rotateWorkspaceDataKey,
} from "../../shared/crypto";
import { freshDb, testEnv } from "../../test/helpers";
import { one } from "./d1";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceDataKeyStore } from "./workspace_data_key_store";
import { D1WorkspaceRepo } from "./workspace_repo";

const USER: User = {
  id: "usr_data_keys",
  name: "Key Owner",
  email: "keys@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const WORKSPACE: Workspace = {
  id: "ws_data_keys",
  name: "Data Keys",
  slug: "data-keys",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_other_data_keys",
  name: "Other Data Keys",
  slug: "other-data-keys",
};

function context(workspaceId: string, recordId: string) {
  return {
    type: "workspace_secret" as const,
    workspaceId,
    recordId,
  };
}

describe("D1WorkspaceDataKeyStore", () => {
  beforeEach(async () => {
    await freshDb();
    await new D1UserRepo(testEnv().DB).insert(USER);
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(OTHER_WORKSPACE);
  });

  it("atomically creates one random wrapped DEK per workspace", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const encrypted = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        encryptSecret(
          `value-${index}`,
          keys,
          context(WORKSPACE.id, `sec_${index}`),
        ),
      ),
    );
    const dataKeyIds = new Set(encrypted.map((value) => value.split(":")[1]));
    expect(dataKeyIds.size).toBe(1);

    const other = await encryptSecret(
      "other",
      keys,
      context(OTHER_WORKSPACE.id, "sec_other"),
    );
    expect(other.split(":")[1]).not.toBe(encrypted[0]?.split(":")[1]);

    const row = await one<{
      total: number;
      active: number;
      distinct_keys: number;
    }>(
      testEnv().DB.prepare(
        `SELECT COUNT(*) AS total, SUM(active) AS active,
                COUNT(DISTINCT data_key_id) AS distinct_keys
         FROM workspace_data_encryption_keys`,
      ),
    );
    expect(row).toEqual({ total: 2, active: 2, distinct_keys: 2 });

    await expect(
      decryptSecret(
        encrypted[0] ?? "",
        keys,
        context(OTHER_WORKSPACE.id, "sec_0"),
      ),
    ).rejects.toThrow("Unknown workspace data key id");
  });

  it("re-wraps a DEK under the active KEK without changing data ciphertext", async () => {
    const store = new D1WorkspaceDataKeyStore(testEnv().DB);
    const oldRoot = new Uint8Array(32).fill(4);
    const newRoot = new Uint8Array(32).fill(5);
    const oldKeys = createEncryptionKeyring(
      { id: "root-old", key: oldRoot },
      [],
      { workspaceDataKeys: store },
    );
    const encrypted = await encryptSecret(
      "survives root rotation",
      oldKeys,
      context(WORKSPACE.id, "sec_root_rotation"),
    );
    const before = await store.findActive(WORKSPACE.id);
    expect(before?.wrappingKeyId).toBe("root-old");

    const rotatingKeys = createEncryptionKeyring(
      { id: "root-new", key: newRoot },
      [{ id: "root-old", key: oldRoot }],
      { workspaceDataKeys: store },
    );
    await expect(
      decryptSecret(
        encrypted,
        rotatingKeys,
        context(WORKSPACE.id, "sec_root_rotation"),
      ),
    ).resolves.toBe("survives root rotation");
    const after = await store.findActive(WORKSPACE.id);
    expect(after?.wrappingKeyId).toBe("root-new");
    expect(after?.wrappedKey).not.toBe(before?.wrappedKey);

    const newOnly = createEncryptionKeyring(
      { id: "root-new", key: newRoot },
      [],
      { workspaceDataKeys: store },
    );
    await expect(
      decryptSecret(
        encrypted,
        newOnly,
        context(WORKSPACE.id, "sec_root_rotation"),
      ),
    ).resolves.toBe("survives root rotation");
  });

  it("rotates a workspace DEK with an optimistic precondition", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const oldCiphertext = await encryptSecret(
      "old generation",
      keys,
      context(WORKSPACE.id, "sec_old_generation"),
    );
    const old = await getActiveWorkspaceDataKey(keys, WORKSPACE.id);
    const rotated = await rotateWorkspaceDataKey(
      keys,
      WORKSPACE.id,
      old.id,
      Date.now() + 1,
    );
    expect(rotated.generation).toBe(2);
    expect(rotated.id).not.toBe(old.id);
    await expect(
      rotateWorkspaceDataKey(
        keys,
        WORKSPACE.id,
        old.id,
        Date.now() + 2,
      ),
    ).rejects.toThrow("Workspace data key changed");

    const newCiphertext = await encryptSecret(
      "new generation",
      keys,
      context(WORKSPACE.id, "sec_new_generation"),
    );
    expect(newCiphertext.split(":")[1]).toBe(rotated.id);
    await expect(
      decryptSecret(
        oldCiphertext,
        keys,
        context(WORKSPACE.id, "sec_old_generation"),
      ),
    ).resolves.toBe("old generation");

    const lifecycle = await one<{ total: number; active: number; retired: number }>(
      testEnv().DB
        .prepare(
          `SELECT COUNT(*) AS total, SUM(active) AS active,
                  SUM(CASE WHEN retired_at IS NOT NULL THEN 1 ELSE 0 END) AS retired
           FROM workspace_data_encryption_keys
           WHERE workspace_id = ?`,
        )
        .bind(WORKSPACE.id),
    );
    expect(lifecycle).toEqual({ total: 2, active: 1, retired: 1 });
  });

  it("fails closed when wrapped key material is tampered", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const encrypted = await encryptSecret(
      "authenticated",
      keys,
      context(WORKSPACE.id, "sec_tampered_wrap"),
    );
    const active = await keys.workspaceDataKeys.findActive(WORKSPACE.id);
    if (active === null) throw new Error("Expected active workspace data key");
    const replacement = active.wrappedKey.endsWith("A") ? "B" : "A";
    await testEnv()
      .DB.prepare(
        `UPDATE workspace_data_encryption_keys
         SET wrapped_key = substr(wrapped_key, 1, length(wrapped_key) - 1) || ?
         WHERE workspace_id = ? AND data_key_id = ?`,
      )
      .bind(replacement, WORKSPACE.id, active.id)
      .run();

    await expect(
      decryptSecret(
        encrypted,
        keys,
        context(WORKSPACE.id, "sec_tampered_wrap"),
      ),
    ).rejects.toThrow();
  });

  it("cannot create key material after a workspace deletion tombstone", async () => {
    await testEnv()
      .DB.prepare(
        `UPDATE workspaces
         SET deletion_state = 'DELETION_PENDING', updated_at = 2
         WHERE id = ?`,
      )
      .bind(WORKSPACE.id)
      .run();
    const keys = loadConfig(testEnv()).encryptionKeys;

    await expect(
      encryptSecret(
        "must not persist",
        keys,
        context(WORKSPACE.id, "sec_after_tombstone"),
      ),
    ).rejects.toThrow("ZENGUY_WORKSPACE_NOT_OPERATIONAL");
    await expect(
      testEnv()
        .DB.prepare(
          `SELECT COUNT(*) AS total FROM workspace_data_encryption_keys
           WHERE workspace_id = ?`,
        )
        .bind(WORKSPACE.id)
        .first<{ total: number }>(),
    ).resolves.toEqual({ total: 0 });
  });
});
