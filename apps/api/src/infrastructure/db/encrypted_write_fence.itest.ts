import { RotateWorkspaceEncryption } from "../../application/security/rotate_workspace_encryption";
import { writeWithActiveDataKeyRetry } from "../../application/security/write_with_active_data_key";
import type { NotificationChannel } from "../../domain/channels/types";
import { STALE_DATA_ENCRYPTION_KEY_MARKER } from "../../domain/security/encryption";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import {
  CURRENT_ENCRYPTION_VERSION,
  decryptSecret,
  encryptSecret,
  getActiveWorkspaceDataKey,
  rotateWorkspaceDataKey,
  type EncryptedRecordType,
  type EncryptionKeyring,
} from "../../shared/crypto";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ChannelRepo } from "./channel_repo";
import { D1EncryptionRotationRepo } from "./encryption_rotation_repo";
import { D1MonitorRepo } from "./monitor_repo";
import { D1SecretRepo } from "./secret_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";

const USER: User = {
  id: "usr_encrypted_fence",
  name: "Fence Owner",
  email: "fence@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const WORKSPACE: Workspace = {
  id: "ws_encrypted_fence",
  name: "Encrypted Fence",
  slug: "encrypted-fence",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_encrypted_fence_other",
  name: "Other encrypted fence",
  slug: "encrypted-fence-other",
};

function context(
  type: EncryptedRecordType,
  recordId: string,
): { type: EncryptedRecordType; workspaceId: string; recordId: string } {
  return { type, workspaceId: WORKSPACE.id, recordId };
}

function secret(id: string, encryptedValue: string): WorkspaceSecret {
  return {
    id,
    workspaceId: WORKSPACE.id,
    key: id.toUpperCase(),
    encryptedValue,
    encryptionVersion: CURRENT_ENCRYPTION_VERSION,
    allowedDomains: [],
    description: null,
    createdBy: USER.id,
    createdAt: 10,
    updatedAt: 10,
  };
}

function channel(id: string, encryptedConfig: string): NotificationChannel {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name: id,
    type: "SLACK",
    encryptedConfig,
    enabled: true,
    isDefault: false,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: USER.id,
    createdAt: 10,
    updatedAt: 10,
  };
}

function monitor(
  id: string,
  encryptedHeaders: string | null,
  encryptedBody: string | null,
): UptimeMonitor {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name: id,
    url: "https://example.com/health",
    method: "POST",
    encryptedHeaders,
    encryptedBody,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 60,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: 70_000,
    currentStatus: "UNKNOWN",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: USER.id,
    createdAt: 10,
    updatedAt: 10,
    deletedAt: null,
  };
}

async function encrypted(
  keys: EncryptionKeyring,
  plaintext: string,
  type: EncryptedRecordType,
  recordId: string,
): Promise<string> {
  return encryptSecret(plaintext, keys, context(type, recordId));
}

async function rotate(keys: EncryptionKeyring, offset: number): Promise<string> {
  const active = await getActiveWorkspaceDataKey(keys, WORKSPACE.id);
  const next = await rotateWorkspaceDataKey(
    keys,
    WORKSPACE.id,
    active.id,
    Date.now() + offset,
  );
  return next.id;
}

describe("active workspace DEK write fence", () => {
  beforeEach(async () => {
    await freshDb();
    await new D1UserRepo(testEnv().DB).insert(USER);
    await new D1WorkspaceRepo(testEnv().DB).insert(WORKSPACE);
  });

  it("makes v1-v3 read-only for every new or changed encrypted value", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const secrets = new D1SecretRepo(testEnv().DB);
    const channels = new D1ChannelRepo(testEnv().DB);
    const monitors = new D1MonitorRepo(testEnv().DB);

    await expect(
      secrets.insert(secret("sec_legacy_after_v4", "v1:legacy:payload")),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      channels.insert(channel("ch_legacy_after_v4", "v2:old:iv:payload")),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);

    // Clearing an optional sensitive field is still valid, but introducing a
    // legacy value after the v4 boundary must fail in the same statement.
    await monitors.insert(monitor("mon_nullable_v4", null, null));
    await expect(
      monitors.update(
        "mon_nullable_v4",
        { encryptedHeaders: "v3:old:iv:payload" },
        20,
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      monitors.update(
        "mon_nullable_v4",
        { encryptedBody: "legacy-plaintext-shaped-value" },
        20,
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      monitors.update("mon_nullable_v4", { encryptedBody: null }, 20),
    ).resolves.toBeUndefined();
  });

  it("keeps secret envelope metadata aligned and encrypted identities immutable", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    await workspaces.insert(OTHER_WORKSPACE);
    const secrets = new D1SecretRepo(testEnv().DB);
    const channels = new D1ChannelRepo(testEnv().DB);
    const monitors = new D1MonitorRepo(testEnv().DB);
    const secretCiphertext = await encrypted(
      keys,
      "metadata-bound secret",
      "workspace_secret",
      "sec_metadata_bound",
    );

    await expect(
      secrets.insert({
        ...secret("sec_bad_metadata", await encrypted(
          keys,
          "bad metadata",
          "workspace_secret",
          "sec_bad_metadata",
        )),
        encryptionVersion: 3,
      }),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await secrets.insert(secret("sec_metadata_bound", secretCiphertext));
    await channels.insert(
      channel(
        "ch_identity_bound",
        await encrypted(
          keys,
          "identity-bound channel",
          "notification_channel",
          "ch_identity_bound",
        ),
      ),
    );
    await monitors.insert(
      monitor(
        "mon_identity_bound",
        await encrypted(
          keys,
          "identity-bound headers",
          "uptime_monitor_headers",
          "mon_identity_bound",
        ),
        null,
      ),
    );

    await expect(
      testEnv()
        .DB.prepare(
          "UPDATE workspace_secrets SET encryption_version = 3 WHERE id = ?",
        )
        .bind("sec_metadata_bound")
        .run(),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      testEnv()
        .DB.prepare(
          "UPDATE workspace_secrets SET workspace_id = ? WHERE id = ?",
        )
        .bind(OTHER_WORKSPACE.id, "sec_metadata_bound")
        .run(),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      testEnv()
        .DB.prepare(
          "UPDATE notification_channels SET id = ? WHERE id = ?",
        )
        .bind("ch_identity_moved", "ch_identity_bound")
        .run(),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      testEnv()
        .DB.prepare(
          "UPDATE uptime_monitors SET workspace_id = ? WHERE id = ?",
        )
        .bind(OTHER_WORKSPACE.id, "mon_identity_bound")
        .run(),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
  });

  it("rejects a writer paused before rotation and retries only its fenced insert", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const secrets = new D1SecretRepo(testEnv().DB);
    const channels = new D1ChannelRepo(testEnv().DB);
    const monitors = new D1MonitorRepo(testEnv().DB);
    const staleSecret = await encrypted(
      keys,
      "stale secret",
      "workspace_secret",
      "sec_fenced_insert",
    );
    const staleChannel = await encrypted(
      keys,
      "stale channel",
      "notification_channel",
      "ch_fenced_insert",
    );
    const [staleHeaders, staleBody] = await Promise.all([
      encrypted(
        keys,
        "stale headers",
        "uptime_monitor_headers",
        "mon_fenced_insert",
      ),
      encrypted(
        keys,
        "stale body",
        "uptime_monitor_body",
        "mon_fenced_insert",
      ),
    ]);
    const oldDataKey = await getActiveWorkspaceDataKey(keys, WORKSPACE.id);
    const completedRotation = await new RotateWorkspaceEncryption(
      new D1EncryptionRotationRepo(testEnv().DB),
      { execute: async () => undefined },
      keys,
      new FixedClock(Date.now() + 10),
    ).execute({
      workspaceId: WORKSPACE.id,
      actor: USER,
      actorRole: "OWNER",
      limit: 10,
      rotateDataKeyFrom: oldDataKey.id,
    });
    expect(completedRotation).toMatchObject({
      examined: 0,
      rotated: 0,
      hasMore: false,
    });
    const activeDataKeyId = completedRotation.activeDataKeyId;

    let attempts = 0;
    const storedSecret = await writeWithActiveDataKeyRetry(
      async () => {
        attempts += 1;
        return attempts === 1
          ? staleSecret
          : encrypted(
              keys,
              "retried secret",
              "workspace_secret",
              "sec_fenced_insert",
            );
      },
      (candidate) => secrets.insert(secret("sec_fenced_insert", candidate)),
    );
    expect(attempts).toBe(2);
    expect(storedSecret).toContain(`v4:${activeDataKeyId}:`);

    await expect(
      channels.insert(channel("ch_fenced_insert", staleChannel)),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      monitors.insert(
        monitor("mon_fenced_insert", staleHeaders, staleBody),
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    expect(await channels.findById(WORKSPACE.id, "ch_fenced_insert")).toBeNull();
    expect(await monitors.findById(WORKSPACE.id, "mon_fenced_insert")).toBeNull();

    const activeChannel = await encrypted(
      keys,
      "active channel",
      "notification_channel",
      "ch_fenced_insert",
    );
    const [activeHeaders, activeBody] = await Promise.all([
      encrypted(
        keys,
        "active headers",
        "uptime_monitor_headers",
        "mon_fenced_insert",
      ),
      encrypted(
        keys,
        "active body",
        "uptime_monitor_body",
        "mon_fenced_insert",
      ),
    ]);
    await channels.insert(channel("ch_fenced_insert", activeChannel));
    await monitors.insert(
      monitor("mon_fenced_insert", activeHeaders, activeBody),
    );
    expect(oldDataKey.id).not.toBe(activeDataKeyId);
  });

  it("atomically rejects stale secret, channel, header and body updates", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const secrets = new D1SecretRepo(testEnv().DB);
    const channels = new D1ChannelRepo(testEnv().DB);
    const monitors = new D1MonitorRepo(testEnv().DB);
    const initialSecret = await encrypted(
      keys,
      "initial secret",
      "workspace_secret",
      "sec_fenced_update",
    );
    const initialChannel = await encrypted(
      keys,
      "initial channel",
      "notification_channel",
      "ch_fenced_update",
    );
    const [initialHeaders, initialBody, staleHeaders, staleBody] =
      await Promise.all([
        encrypted(
          keys,
          "initial headers",
          "uptime_monitor_headers",
          "mon_fenced_update",
        ),
        encrypted(
          keys,
          "initial body",
          "uptime_monitor_body",
          "mon_fenced_update",
        ),
        encrypted(
          keys,
          "stale headers",
          "uptime_monitor_headers",
          "mon_fenced_update",
        ),
        encrypted(
          keys,
          "stale body",
          "uptime_monitor_body",
          "mon_fenced_update",
        ),
      ]);
    const staleSecret = await encrypted(
      keys,
      "stale replacement",
      "workspace_secret",
      "sec_fenced_update",
    );
    const staleChannel = await encrypted(
      keys,
      "stale replacement",
      "notification_channel",
      "ch_fenced_update",
    );
    await secrets.insert(secret("sec_fenced_update", initialSecret));
    await channels.insert(channel("ch_fenced_update", initialChannel));
    await monitors.insert(
      monitor("mon_fenced_update", initialHeaders, initialBody),
    );
    await rotate(keys, 20);

    await expect(
      secrets.updateValue(
        "sec_fenced_update",
        staleSecret,
        CURRENT_ENCRYPTION_VERSION,
        20,
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      channels.update(
        "ch_fenced_update",
        { name: "must-roll-back", encryptedConfig: staleChannel },
        20,
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      monitors.update(
        "mon_fenced_update",
        { name: "must-roll-back", encryptedHeaders: staleHeaders },
        20,
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);
    await expect(
      monitors.update(
        "mon_fenced_update",
        { encryptedBody: staleBody },
        20,
      ),
    ).rejects.toThrow(STALE_DATA_ENCRYPTION_KEY_MARKER);

    expect((await channels.findById(WORKSPACE.id, "ch_fenced_update"))?.name)
      .toBe("ch_fenced_update");
    expect((await monitors.findById(WORKSPACE.id, "mon_fenced_update"))?.name)
      .toBe("mon_fenced_update");
    expect((await secrets.findById(WORKSPACE.id, "sec_fenced_update"))?.encryptedValue)
      .toBe(initialSecret);

    const activeSecret = await encrypted(
      keys,
      "active replacement",
      "workspace_secret",
      "sec_fenced_update",
    );
    const activeChannel = await encrypted(
      keys,
      "active replacement",
      "notification_channel",
      "ch_fenced_update",
    );
    const [activeHeaders, activeBody] = await Promise.all([
      encrypted(
        keys,
        "active headers",
        "uptime_monitor_headers",
        "mon_fenced_update",
      ),
      encrypted(
        keys,
        "active body",
        "uptime_monitor_body",
        "mon_fenced_update",
      ),
    ]);
    await secrets.updateValue(
      "sec_fenced_update",
      activeSecret,
      CURRENT_ENCRYPTION_VERSION,
      30,
    );
    await channels.update(
      "ch_fenced_update",
      { encryptedConfig: activeChannel },
      30,
    );
    await monitors.update(
      "mon_fenced_update",
      { encryptedHeaders: activeHeaders, encryptedBody: activeBody },
      30,
    );
  });

  it("rejects a rotation batch prepared under a DEK retired before its CAS", async () => {
    const keys = loadConfig(testEnv()).encryptionKeys;
    const secrets = new D1SecretRepo(testEnv().DB);
    const channels = new D1ChannelRepo(testEnv().DB);
    const monitors = new D1MonitorRepo(testEnv().DB);
    const rotation = new D1EncryptionRotationRepo(testEnv().DB);
    const initial = {
      secret: await encrypted(
        keys,
        "secret",
        "workspace_secret",
        "sec_rotation_fence",
      ),
      channel: await encrypted(
        keys,
        "channel",
        "notification_channel",
        "ch_rotation_fence",
      ),
      headers: await encrypted(
        keys,
        "headers",
        "uptime_monitor_headers",
        "mon_rotation_fence",
      ),
      body: await encrypted(
        keys,
        "body",
        "uptime_monitor_body",
        "mon_rotation_fence",
      ),
    };
    await secrets.insert(secret("sec_rotation_fence", initial.secret));
    await channels.insert(channel("ch_rotation_fence", initial.channel));
    await monitors.insert(
      monitor("mon_rotation_fence", initial.headers, initial.body),
    );
    const generationTwo = await rotate(keys, 30);
    const pending = await rotation.listPending(
      WORKSPACE.id,
      generationTwo,
      10,
    );
    const replacements = await Promise.all(
      pending.map(async (record) => {
        const recordContext = context(record.type, record.recordId);
        const plaintext = await decryptSecret(
          record.ciphertext,
          keys,
          recordContext,
        );
        return {
          ...record,
          replacement: await encryptSecret(plaintext, keys, recordContext),
        };
      }),
    );
    const generationThree = await rotate(keys, 40);

    await expect(rotation.replaceIfUnchanged(replacements, 40)).resolves.toEqual(
      replacements.map(() => false),
    );
    expect(
      (await secrets.findById(WORKSPACE.id, "sec_rotation_fence"))
        ?.encryptedValue,
    ).toBe(initial.secret);

    const result = await new RotateWorkspaceEncryption(
      rotation,
      { execute: async () => undefined },
      keys,
      new FixedClock(Date.now() + 50),
    ).execute({
      workspaceId: WORKSPACE.id,
      actor: USER,
      actorRole: "OWNER",
      limit: 10,
    });
    expect(result).toMatchObject({
      activeDataKeyId: generationThree,
      examined: 4,
      rotated: 4,
      conflicted: 0,
      hasMore: false,
    });
    for (const record of await rotation.listPending(
      WORKSPACE.id,
      generationThree,
      1,
    )) {
      expect.unreachable(`remaining record ${record.type}:${record.recordId}`);
    }
  });
});
