import type {
  ChannelSender,
  NotificationMessage,
} from "../../domain/channels/notifier";
import {
  providerAmbiguous,
  providerRejected,
} from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type {
  ChannelType,
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import { defaultAlertSettings } from "../../domain/alerts/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { createEncryptionKeyring, encryptSecret } from "../../shared/crypto";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { RecordingEmailSender } from "../../test/fakes/email";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeChannelRepo,
  FakeDeliveryRepo,
} from "../../test/fakes/repos";
import { ChargePaidDelivery } from "../alerts/charge_paid_delivery";
import type {
  IncidentEventWriter,
  IncidentNotificationEvent,
} from "./incident_event_writer";
import { SendQueuedNotification } from "./send_queued_notification";

const KEY = new Uint8Array(32).fill(9);
const KEYS = createEncryptionKeyring({ id: "test-paid-queue", key: KEY });
const NOW = 5_000;
const MESSAGE: NotificationMessage = {
  eventType: "FAILURE",
  title: "❌ Checkout failed",
  lines: ["Checkout failed."],
  link: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
  speakText: "Zenguy alert. Checkout failed.",
  shortText: "Zenguy: FAILED Checkout.",
  color: "red",
};
const WORKSPACE: Workspace = {
  id: "ws_1",
  name: "Acme",
  slug: "acme",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const OWNER: User = {
  id: "usr_owner",
  name: "Owner",
  email: "owner@acme.test",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

class RecordingIncidentEvents implements IncidentEventWriter {
  readonly events: IncidentNotificationEvent[] = [];

  async write(event: IncidentNotificationEvent): Promise<void> {
    this.events.push({ ...event });
  }
}

class SelectiveSender implements ChannelSender {
  readonly calls: ChannelType[] = [];
  failures = 0;
  ambiguous = false;

  async send(channel: {
    type: ChannelType;
    config: unknown;
  }): Promise<{ providerMessageId: string | null }> {
    this.calls.push(channel.type);
    if (this.failures > 0) {
      this.failures -= 1;
      throw this.ambiguous
        ? providerAmbiguous("twilio error network")
        : providerRejected("twilio error 500");
    }
    return { providerMessageId: `provider-${channel.type}` };
  }
}

class RecordingMessage implements Message<NotifyMessage> {
  readonly id = "msg";
  readonly timestamp = new Date(0);
  readonly attempts = 1;
  readonly retryOptions: QueueRetryOptions[] = [];
  ackCount = 0;

  constructor(readonly body: NotifyMessage) {}

  retry(options: QueueRetryOptions = {}): void {
    this.retryOptions.push(options);
  }

  ack(): void {
    this.ackCount += 1;
  }
}

async function smsChannel(id: string): Promise<NotificationChannel> {
  return {
    id,
    workspaceId: "ws_1",
    name: "On-call SMS",
    type: "SMS",
    encryptedConfig: await encryptSecret(
      JSON.stringify({ phoneNumber: "+34600123456", consent: true }),
      KEYS,
      { type: "notification_channel", workspaceId: "ws_1", recordId: id },
    ),
    enabled: true,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: "usr_1",
    createdAt: 1,
    updatedAt: 1,
  };
}

function delivery(id: string, channelId: string): NotificationDelivery {
  return {
    id,
    workspaceId: "ws_1",
    incidentId: "inc_1",
    notificationChannelId: channelId,
    eventType: "FAILURE",
    status: "PENDING",
    providerMessageId: null,
    attemptCount: 0,
    errorSanitized: null,
    sentAt: null,
    createdAt: 1,
  };
}

function notify(deliveryId: string, channelId: string): NotifyMessage {
  return { kind: "notify", deliveryId, workspaceId: "ws_1", channelId, message: MESSAGE };
}

async function fixture(options: { enabled?: boolean; balance?: number } = {}) {
  const channels = new FakeChannelRepo();
  const deliveries = new FakeDeliveryRepo();
  const sender = new SelectiveSender();
  const incidents = new RecordingIncidentEvents();
  const alerts = new FakeAlertRepo();
  alerts.settings.set("ws_1", {
    ...defaultAlertSettings("ws_1", 1),
    paidChannelsEnabled: options.enabled ?? true,
  });
  alerts.setBalance("ws_1", options.balance ?? 100);
  const clock = new FixedClock(NOW);
  const charger = new ChargePaidDelivery(
    alerts,
    { findById: async () => WORKSPACE },
    { findById: async () => OWNER },
    new RecordingEmailSender(),
    "https://app.zenguy.test",
    clock,
    new FakeIds(),
  );
  const consumer = new SendQueuedNotification(
    deliveries,
    channels,
    sender,
    incidents,
    KEYS,
    clock,
    charger,
  );
  await channels.insert(await smsChannel("ch_sms"));
  await deliveries.insert(delivery("del_1", "ch_sms"));
  return { channels, deliveries, sender, incidents, alerts, consumer };
}

describe("SendQueuedNotification with paid channels", () => {
  it("charges before sending and records the cost on the delivery", async () => {
    const { deliveries, sender, alerts, incidents, consumer } = await fixture();
    const body = notify("del_1", "ch_sms");
    const message = new RecordingMessage(body);

    await consumer.execute(body, message);

    expect(sender.calls).toEqual(["SMS"]);
    expect(message.ackCount).toBe(1);
    await expect(deliveries.findById("ws_1", "del_1")).resolves.toMatchObject({
      status: "SENT",
      costCents: 18,
      destinationCountry: "Spain",
      providerMessageId: "provider-SMS",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);
    expect(incidents.events).toEqual([
      expect.objectContaining({ type: "NOTIFICATION_SENT", deliveryId: "del_1" }),
    ]);
  });

  it("skips without calling the provider when credit is missing", async () => {
    const { deliveries, sender, channels, incidents, consumer } = await fixture({
      balance: 5,
    });
    const body = notify("del_1", "ch_sms");
    const message = new RecordingMessage(body);

    await consumer.execute(body, message);

    expect(sender.calls).toEqual([]);
    expect(message.ackCount).toBe(1);
    expect(message.retryOptions).toEqual([]);
    await expect(deliveries.findById("ws_1", "del_1")).resolves.toMatchObject({
      status: "FAILED",
      attemptCount: 1,
      errorSanitized: "Skipped: not enough alert credit (€0.18 needed, €0.05 left)",
    });
    await expect(channels.findById("ws_1", "ch_sms")).resolves.toMatchObject({
      lastDeliveryStatus: "FAILED",
    });
    expect(incidents.events).toEqual([
      expect.objectContaining({
        type: "NOTIFICATION_FAILED",
        status: "FAILED",
        detail: "Skipped: not enough alert credit (€0.18 needed, €0.05 left)",
      }),
    ]);
  });

  it("skips when SMS & calls are off", async () => {
    const { deliveries, sender, consumer } = await fixture({ enabled: false });
    const body = notify("del_1", "ch_sms");
    await consumer.execute(body, new RecordingMessage(body));
    expect(sender.calls).toEqual([]);
    await expect(deliveries.findById("ws_1", "del_1")).resolves.toMatchObject({
      status: "FAILED",
      errorSanitized: "Skipped: SMS & calls are turned off for this workspace",
    });
  });

  it("refuses legacy paid destinations without explicit recipient consent", async () => {
    const { deliveries, sender, channels, alerts, consumer } = await fixture();
    const legacy = await encryptSecret(
      JSON.stringify({ phoneNumber: "+34600123456" }),
      KEYS,
      {
        type: "notification_channel",
        workspaceId: "ws_1",
        recordId: "ch_sms",
      },
    );
    await channels.update("ch_sms", { encryptedConfig: legacy }, NOW);
    const body = notify("del_1", "ch_sms");
    const message = new RecordingMessage(body);

    await consumer.execute(body, message);

    expect(sender.calls).toEqual([]);
    expect(message.ackCount).toBe(1);
    expect(await alerts.getBalanceCents("ws_1")).toBe(100);
    await expect(deliveries.findById("ws_1", "del_1")).resolves.toMatchObject({
      status: "FAILED",
      errorSanitized: "explicit recipient consent is required",
    });
  });

  it("keeps a single charge across provider retries and refunds on final failure", async () => {
    const { deliveries, sender, alerts, consumer } = await fixture();
    sender.failures = 3;
    const body = notify("del_1", "ch_sms");

    const first = new RecordingMessage(body);
    await consumer.execute(body, first);
    expect(first.retryOptions).toEqual([{ delaySeconds: 30 }]);
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);

    const second = new RecordingMessage(body);
    await consumer.execute(body, second);
    expect(second.retryOptions).toEqual([{ delaySeconds: 60 }]);
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);
    expect(alerts.entries.filter((entry) => entry.kind === "CHARGE")).toHaveLength(1);

    const third = new RecordingMessage(body);
    await consumer.execute(body, third);
    expect(third.ackCount).toBe(1);
    await expect(deliveries.findById("ws_1", "del_1")).resolves.toMatchObject({
      status: "FAILED",
      attemptCount: 3,
      errorSanitized: "twilio error 500",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(100);
    expect(alerts.entries.at(-1)).toMatchObject({
      kind: "REFUND",
      amountCents: 18,
      deliveryId: "del_1",
    });
    expect(sender.calls).toEqual(["SMS", "SMS", "SMS"]);
  });

  it("keeps the charge reserved and does not resend an ambiguous paid delivery", async () => {
    const { deliveries, sender, alerts, consumer } = await fixture();
    sender.failures = 1;
    sender.ambiguous = true;
    const body = notify("del_1", "ch_sms");
    const first = new RecordingMessage(body);

    await consumer.execute(body, first);

    expect(first.ackCount).toBe(1);
    expect(first.retryOptions).toEqual([]);
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);
    expect(alerts.entries.filter((entry) => entry.kind === "REFUND")).toEqual([]);
    await expect(deliveries.findById("ws_1", "del_1")).resolves.toMatchObject({
      status: "PENDING",
      dispatchState: "AMBIGUOUS",
      attemptCount: 1,
    });

    await consumer.execute(body, new RecordingMessage(body));
    expect(sender.calls).toEqual(["SMS"]);
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);
  });
});
