import type {
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import { encryptSecret } from "../../shared/crypto";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ChannelRepo } from "./channel_repo";
import { D1DeliveryRepo } from "./delivery_repo";

const WEBHOOK_URL =
  "https://hooks.slack.com/services/T000/B000/plaintext-secret";
const ENCRYPTION_KEY = new Uint8Array(32).fill(7);

async function channel(
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
      ENCRYPTION_KEY,
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
  };
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
    const primary = await channel();
    const second = await channel("ch_second", "ws_primary", 2_000);
    const other = await channel("ch_other", "ws_other", 3_000);
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
    await expect(
      channels.listByIds("ws_primary", [primary.id, other.id]),
    ).resolves.toEqual([primary]);

    await channels.update(
      primary.id,
      { name: "Renamed", enabled: false, encryptedConfig: "encrypted-new" },
      4_000,
    );
    await channels.setLastDeliveryStatus(primary.id, "SENT");
    await channels.setVerified(primary.id, 5_000);
    await channels.setVerified(primary.id, 6_000);
    await expect(channels.findById("ws_primary", primary.id)).resolves.toEqual({
      ...primary,
      name: "Renamed",
      enabled: false,
      encryptedConfig: "encrypted-new",
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
        providerMessageId: "provider_123",
        errorSanitized: "timeout",
        attemptCount: 3,
        sentAt: 4_000,
      },
      oldest,
    ]);
  });
});
