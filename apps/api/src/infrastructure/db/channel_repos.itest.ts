import type {
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import { loadConfig } from "../../shared/config";
import { encryptSecret, type EncryptionKeyring } from "../../shared/crypto";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ChannelRepo } from "./channel_repo";
import { D1DeliveryRepo } from "./delivery_repo";

const WEBHOOK_URL =
  "https://hooks.slack.com/services/T000/B000/plaintext-secret";
async function channel(
  encryptionKeys: EncryptionKeyring,
  id = "ch_primary",
  workspaceId = "ws_primary",
  createdAt = 1_000,
): Promise<NotificationChannel> {
  return {
    id,
    workspaceId,
    name: "Ops Slack",
    type: "SLACK",
    encryptedConfig: await encryptSecret(
      JSON.stringify({ webhookUrl: WEBHOOK_URL }),
      encryptionKeys,
      { type: "notification_channel", workspaceId, recordId: id },
    ),
    enabled: true,
    isDefault: false,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: "usr_owner",
    createdAt,
    updatedAt: createdAt,
  };
}

function delivery(
  id: string,
  channelId: string,
  createdAt: number,
  incidentId: string | null = "inc_primary",
): NotificationDelivery {
  return {
    id,
    workspaceId: "ws_primary",
    incidentId,
    notificationChannelId: channelId,
    eventType: "FAILURE",
    status: "PENDING",
    providerMessageId: null,
    attemptCount: 0,
    errorSanitized: null,
    sentAt: null,
    createdAt,
    costCents: null,
    destinationCountry: null,
    dispatchState: "READY",
    providerIdempotencyKey: id,
    dispatchGeneration: 0,
  };
}

async function insertWorkspace(id = "ws_primary"): Promise<void> {
  await testEnv()
    .DB.prepare(
      `INSERT INTO workspaces
        (id, name, slug, timezone, owner_user_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'UTC', 'usr_owner', 1, 1, NULL)`,
    )
    .bind(id, `Workspace ${id}`, `slug-${id}`)
    .run();
}

describe("D1 channel repositories", () => {
  let channels: D1ChannelRepo;
  let deliveries: D1DeliveryRepo;

  beforeEach(async () => {
    await freshDb();
    channels = new D1ChannelRepo(testEnv().DB);
    deliveries = new D1DeliveryRepo(testEnv().DB);
  });

  it("stores encrypted config, scopes reads, updates, verifies once, and deletes", async () => {
    await insertWorkspace("ws_primary");
    await insertWorkspace("ws_other");
    const encryptionKeys = loadConfig(testEnv()).encryptionKeys;
    const primary = await channel(encryptionKeys);
    const second = await channel(
      encryptionKeys,
      "ch_second",
      "ws_primary",
      2_000,
    );
    const other = await channel(
      encryptionKeys,
      "ch_other",
      "ws_other",
      3_000,
    );
    await channels.insert(primary);
    await channels.insert(second);
    await channels.insert(other);

    const raw = await testEnv()
      .DB.prepare(
        "SELECT encrypted_config FROM notification_channels WHERE id = ?",
      )
      .bind(primary.id)
      .first<{ encrypted_config: string }>();
    expect(raw?.encrypted_config).not.toContain(WEBHOOK_URL);
    expect(raw?.encrypted_config).not.toContain("plaintext-secret");
    await expect(channels.findById("ws_primary", primary.id)).resolves.toEqual(
      primary,
    );
    await expect(channels.findById("ws_other", primary.id)).resolves.toBeNull();
    await expect(channels.list("ws_primary")).resolves.toEqual([
      second,
      primary,
    ]);
    await expect(channels.listPage("ws_primary", null, 1)).resolves.toEqual([
      second,
    ]);
    await expect(
      channels.listPage(
        "ws_primary",
        { createdAt: second.createdAt, id: second.id },
        2,
      ),
    ).resolves.toEqual([primary]);
    await expect(
      channels.listByIds("ws_primary", [primary.id, other.id]),
    ).resolves.toEqual([primary]);

    const encryptedNew = await encryptSecret(
      JSON.stringify({ webhookUrl: "https://hooks.slack.test/replacement" }),
      encryptionKeys,
      {
        type: "notification_channel",
        workspaceId: primary.workspaceId,
        recordId: primary.id,
      },
    );
    await channels.update(
      primary.id,
      { name: "Renamed", enabled: false, encryptedConfig: encryptedNew },
      4_000,
    );
    await channels.setLastDeliveryStatus(primary.id, "SENT");
    await channels.setVerified(primary.id, 5_000);
    await channels.setVerified(primary.id, 6_000);
    await expect(channels.findById("ws_primary", primary.id)).resolves.toEqual({
      ...primary,
      name: "Renamed",
      enabled: false,
      encryptedConfig: encryptedNew,
      verifiedAt: 5_000,
      lastDeliveryStatus: "SENT",
      updatedAt: 4_000,
    });

    await channels.delete(primary.id);
    await expect(channels.findById("ws_primary", primary.id)).resolves.toBeNull();
  });

  it("round-trips deliveries, applies updates, keyset-paginates, and lists incidents", async () => {
    const channelId = "ch_primary";
    const oldest = delivery("del_oldest", channelId, 1_000);
    const middle = delivery("del_middle", channelId, 2_000);
    const newest = delivery("del_newest", channelId, 3_000, null);
    for (const item of [oldest, middle, newest]) await deliveries.insert(item);

    await expect(
      deliveries.findById("ws_primary", middle.id),
    ).resolves.toEqual(middle);
    await expect(
      deliveries.findById("ws_other", middle.id),
    ).resolves.toBeNull();

    await expect(
      deliveries.listForChannel(channelId, null, 2),
    ).resolves.toEqual([newest, middle]);
    await expect(
      deliveries.listForChannel(
        channelId,
        { createdAt: middle.createdAt, id: middle.id },
        2,
      ),
    ).resolves.toEqual([oldest]);
    await expect(deliveries.listForIncident("inc_primary")).resolves.toEqual([
      oldest,
      middle,
    ]);

    await deliveries.update(middle.id, {
      status: "FAILED",
      providerMessageId: "provider_123",
      errorSanitized: "timeout",
      attemptCount: 3,
      sentAt: 4_000,
    });
    await expect(
      deliveries.listForChannel(channelId, null, 3),
    ).resolves.toEqual([
      newest,
      {
        ...middle,
        status: "FAILED",
        dispatchState: "CONFIRMED",
        providerMessageId: "provider_123",
        errorSanitized: "timeout",
        attemptCount: 3,
        sentAt: 4_000,
      },
      oldest,
    ]);
  });

  it("fences concurrent provider dispatches and resolves stale outcomes without resending", async () => {
    await insertWorkspace();
    const value = delivery("del_fenced", "ch_fenced", 1_000, null);
    await deliveries.insert(value);

    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        deliveries.beginDispatch(
          value.workspaceId,
          value.id,
          `dispatch_${index}`,
          2_000,
          1_000,
        ),
      ),
    );
    const owners = claims.filter((claim) => claim !== null);
    expect(owners).toHaveLength(1);
    expect(owners[0]?.delivery).toMatchObject({
      status: "PENDING",
      dispatchState: "DISPATCHING",
      attemptCount: 1,
      dispatchGeneration: 1,
      providerIdempotencyKey: value.id,
    });
    await expect(
      deliveries.finishDispatch(value.id, "wrong-token", {
        status: "SENT",
        attemptCount: 1,
      }),
    ).resolves.toBe(false);

    const ambiguous = await deliveries.markStaleDispatchAmbiguous(
      value.workspaceId,
      value.id,
      2_000,
      "provider outcome ambiguous",
    );
    expect(ambiguous).toMatchObject({
      status: "PENDING",
      dispatchState: "AMBIGUOUS",
      errorSanitized: "provider outcome ambiguous",
    });
    await expect(
      deliveries.finishDispatch(value.id, owners[0]?.dispatchToken ?? "", {
        status: "FAILED",
        attemptCount: 1,
      }),
    ).resolves.toBe(false);

    await expect(
      deliveries.recordProviderAcceptance(
        value.id,
        value.id,
        "provider_message_1",
        3_000,
      ),
    ).resolves.toBe(true);
    await expect(
      deliveries.findById(value.workspaceId, value.id),
    ).resolves.toMatchObject({
      status: "SENT",
      dispatchState: "CONFIRMED",
      providerMessageId: "provider_message_1",
      sentAt: 3_000,
    });
  });

  it("refuses a provider claim after the workspace deletion tombstone", async () => {
    await insertWorkspace();
    const value = delivery("del_deleted_ws", "ch_deleted", 1_000, null);
    await deliveries.insert(value);
    await testEnv()
      .DB.prepare(
        `UPDATE workspaces
         SET deletion_state = 'DELETION_PENDING', deleted_at = 2_000
         WHERE id = ?`,
      )
      .bind(value.workspaceId)
      .run();

    await expect(
      deliveries.beginDispatch(
        value.workspaceId,
        value.id,
        "dispatch_deleted",
        3_000,
        0,
      ),
    ).resolves.toBeNull();
  });
});
