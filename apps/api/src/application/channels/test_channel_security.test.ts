import type { ChannelSender } from "../../domain/channels/notifier";
import type { NotificationChannel } from "../../domain/channels/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import {
  createEncryptionKeyring,
  encryptSecret,
  sha256Hex,
} from "../../shared/crypto";
import type { RateLimiter } from "../../shared/ratelimit";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeChannelRepo,
  FakeDeliveryRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";
import { TestChannel } from "./test_channel";

const KEYS = createEncryptionKeyring({
  id: "test-channel-security",
  key: new Uint8Array(32).fill(4),
});
const ACTOR: User = {
  id: "usr_owner",
  name: "Owner",
  email: "owner@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

class RecordingRateLimiter implements RateLimiter {
  readonly keys: string[] = [];
  blockDestination = false;

  async hit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    this.keys.push(key);
    return {
      allowed: !(this.blockDestination && key.startsWith("channel_test:destination:")),
      retryAfterSeconds: 60,
    };
  }
}

async function emailChannel(): Promise<NotificationChannel> {
  return {
    id: "ch_email",
    workspaceId: "ws_1",
    name: "Email",
    type: "EMAIL",
    encryptedConfig: await encryptSecret(
      JSON.stringify({ emails: ["Recipient@Example.com"] }),
      KEYS,
      {
        type: "notification_channel",
        workspaceId: "ws_1",
        recordId: "ch_email",
      },
    ),
    enabled: true,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: ACTOR.id,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("TestChannel security scopes", () => {
  it("uses independent workspace, actor, hashed IP and hashed destination budgets", async () => {
    const channels = new FakeChannelRepo();
    const deliveries = new FakeDeliveryRepo();
    const subscriptions = new FakeSubscriptionRepo();
    const limiter = new RecordingRateLimiter();
    limiter.blockDestination = true;
    await channels.insert(await emailChannel());
    subscriptions.subscriptions.set("ws_1", {
      id: "sub_1",
      workspaceId: "ws_1",
      provider: "internal",
      providerCustomerId: null,
      providerSubscriptionId: null,
      status: "ACTIVE",
      periodStart: 1,
      periodEnd: 10_000,
      cancelAtPeriodEnd: false,
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const sender: ChannelSender = { send: vi.fn() };
    const useCase = new TestChannel(
      channels,
      deliveries,
      subscriptions,
      sender,
      limiter,
      { execute: vi.fn() },
      { appUrl: "https://app.example.com", encryptionKeys: KEYS },
      new FixedClock(1_000),
      new FakeIds(),
      { charge: vi.fn(), refund: vi.fn() },
    );

    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        workspaceName: "Workspace",
        channelId: "ch_email",
        actor: ACTOR,
        actorRole: "OWNER",
        ip: "203.0.113.42",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const ipHash = await sha256Hex("203.0.113.42");
    const destinationHash = await sha256Hex("EMAIL:recipient@example.com");
    expect(limiter.keys).toEqual([
      "channel_test:workspace:ws_1",
      "channel_test:actor:usr_owner",
      `channel_test:ip:${ipHash}`,
      `channel_test:destination:${destinationHash}`,
    ]);
    expect(limiter.keys.join(" ")).not.toContain("203.0.113.42");
    expect(limiter.keys.join(" ")).not.toContain("recipient@example.com");
    expect(deliveries.deliveries.size).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });
});
