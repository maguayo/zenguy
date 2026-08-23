import type { NotificationChannel } from "../../domain/channels/types";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import {
  createEncryptionKeyring,
  decryptSecret,
  encryptLegacySecretForMigration,
  encryptSecret,
  encryptV2SecretForMigration,
  getActiveWorkspaceDataKey,
} from "../../shared/crypto";
import {
  freshDb,
  insertPreFenceLegacyFixture,
  testEnv,
} from "../../test/helpers";
import { D1ChannelRepo } from "./channel_repo";
import { D1EncryptionRotationRepo } from "./encryption_rotation_repo";
import { D1MonitorRepo } from "./monitor_repo";
import { D1SecretRepo } from "./secret_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceDataKeyStore } from "./workspace_data_key_store";
import { D1WorkspaceRepo } from "./workspace_repo";

const OLD_KEY = new Uint8Array(32).fill(4);
const NEW_KEY = new Uint8Array(32).fill(5);
const OLD_KEYS = createEncryptionKeyring({ id: "key-old", key: OLD_KEY });
const USER: User = {
  id: "usr_rotation",
  name: "Rotation Owner",
  email: "rotation@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const WORKSPACE: Workspace = {
  id: "ws_rotation",
  name: "Rotation",
  slug: "rotation",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
describe("D1EncryptionRotationRepo", () => {
  beforeEach(async () => {
    await freshDb();
    await new D1UserRepo(testEnv().DB).insert(USER);
    await new D1WorkspaceRepo(testEnv().DB).insert(WORKSPACE);
  });

  it("finds v1/previous-key values and compare-and-swaps every storage shape", async () => {
    const newKeys = createEncryptionKeyring(
      { id: "key-new", key: NEW_KEY },
      [],
      { workspaceDataKeys: new D1WorkspaceDataKeyStore(testEnv().DB) },
    );
    const secret: WorkspaceSecret = {
      id: "sec_rotation",
      workspaceId: WORKSPACE.id,
      key: "ROTATION_SECRET",
      encryptedValue: await encryptLegacySecretForMigration("secret", OLD_KEY),
      encryptionVersion: 1,
      allowedDomains: ["example.com"],
      description: null,
      createdBy: USER.id,
      createdAt: 1,
      updatedAt: 1,
    };
    const channel: NotificationChannel = {
      id: "ch_rotation",
      workspaceId: WORKSPACE.id,
      name: "Email",
      type: "EMAIL",
      encryptedConfig: await encryptV2SecretForMigration("channel", OLD_KEYS, {
        type: "notification_channel",
        workspaceId: WORKSPACE.id,
        recordId: "ch_rotation",
      }),
      enabled: true,
      isDefault: false,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: USER.id,
      createdAt: 1,
      updatedAt: 1,
    };
    const monitor: UptimeMonitor = {
      id: "mon_rotation",
      workspaceId: WORKSPACE.id,
      name: "Monitor",
      url: "https://example.com",
      method: "POST",
      encryptedHeaders: await encryptV2SecretForMigration("headers", OLD_KEYS, {
        type: "uptime_monitor_headers",
        workspaceId: WORKSPACE.id,
        recordId: "mon_rotation",
      }),
      encryptedBody: await encryptV2SecretForMigration("body", OLD_KEYS, {
        type: "uptime_monitor_body",
        workspaceId: WORKSPACE.id,
        recordId: "mon_rotation",
      }),
      expectedStatus: 200,
      bodyCondition: null,
      bodyExpectedValue: null,
      bodyConditionPath: null,
      frequencySeconds: 300,
      timeoutSeconds: 10,
      maxRetries: 0,
      notifyOnRecovery: true,
      nextCheckAt: 2,
      currentStatus: "UNKNOWN",
      currentCycleId: null,
      cycleStartedAt: null,
      lastCheckAt: null,
      lastResponseTimeMs: null,
      createdBy: USER.id,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    // These rows model data committed before migration 0040 made v1-v3
    // read-only. Disable only the test database triggers while arranging that
    // historical state, then reinstall the exact migration before exercising
    // the rotation repository.
    await insertPreFenceLegacyFixture(async () => {
      await new D1SecretRepo(testEnv().DB).insert(secret);
      await new D1ChannelRepo(testEnv().DB).insert(channel);
      await new D1MonitorRepo(testEnv().DB).insert(monitor);
    });

    const repo = new D1EncryptionRotationRepo(testEnv().DB);
    const activeDataKey = await getActiveWorkspaceDataKey(
      newKeys,
      WORKSPACE.id,
    );
    const pending = await repo.listPending(
      WORKSPACE.id,
      activeDataKey.id,
      10,
    );
    expect(pending.map(({ type, recordId }) => `${type}:${recordId}`)).toEqual([
      "notification_channel:ch_rotation",
      "uptime_monitor_body:mon_rotation",
      "uptime_monitor_headers:mon_rotation",
      "workspace_secret:sec_rotation",
    ]);
    const replacements = await Promise.all(
      pending.map(async (record) => ({
        ...record,
        replacement: await encryptSecret(record.type, newKeys, {
          type: record.type,
          workspaceId: record.workspaceId,
          recordId: record.recordId,
        }),
      })),
    );

    await expect(repo.replaceIfUnchanged(replacements, 5)).resolves.toEqual([
      true,
      true,
      true,
      true,
    ]);
    await expect(repo.replaceIfUnchanged(replacements, 6)).resolves.toEqual([
      false,
      false,
      false,
      false,
    ]);
    await expect(
      repo.listPending(WORKSPACE.id, activeDataKey.id, 10),
    ).resolves.toEqual([]);
    const storedSecret = await new D1SecretRepo(testEnv().DB).findById(
      WORKSPACE.id,
      secret.id,
    );
    expect(storedSecret?.encryptionVersion).toBe(4);
    await expect(
      decryptSecret(storedSecret?.encryptedValue ?? "", newKeys, {
        type: "workspace_secret",
        workspaceId: WORKSPACE.id,
        recordId: secret.id,
      }),
    ).resolves.toBe("workspace_secret");
  });
});
