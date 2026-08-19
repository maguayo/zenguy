import { processNotifyBatch } from "../../index";
import type {
  ChannelSender,
  NotificationMessage,
} from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type {
  ChannelType,
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import { FixedClock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import {
  FakeChannelRepo,
  FakeDeliveryRepo,
} from "../../test/fakes/repos";
import type {
  IncidentEventWriter,
  IncidentNotificationEvent,
} from "./incident_event_writer";
import { SendQueuedNotification } from "./send_queued_notification";

const ENCRYPTION_KEY = new Uint8Array(32).fill(9);
const MESSAGE: NotificationMessage = {
  eventType: "FAILURE",
  title: "❌ Checkout failed",
  lines: ["Checkout failed."],
  link: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
  speakText: "Zenguy alert. Checkout failed.",
  shortText: "Zenguy: FAILED Checkout.",
  color: "red",
};

class RecordingIncidentEvents implements IncidentEventWriter {
  readonly events: IncidentNotificationEvent[] = [];

  async write(event: IncidentNotificationEvent): Promise<void> {
    this.events.push({ ...event });
  }
}

class FailOnceIncidentEvents extends RecordingIncidentEvents {
  private failed = false;

  override async write(event: IncidentNotificationEvent): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("incident event unavailable");
    }
    await super.write(event);
  }
}

class FailOnceChannelRepo extends FakeChannelRepo {
  private failed = false;

  override async setLastDeliveryStatus(
    id: string,
    status: string,
  ): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("channel update unavailable");
    }
    await super.setLastDeliveryStatus(id, status);
  }
}

class SelectiveSender implements ChannelSender {
  readonly calls: ChannelType[] = [];
  readonly failures = new Set<ChannelType>();
  failureMessage = "provider unavailable";

  async send(
    channel: { type: ChannelType; config: unknown },
  ): Promise<{ providerMessageId: string | null }> {
    this.calls.push(channel.type);
    if (this.failures.has(channel.type)) {
      throw new Error(this.failureMessage);
    }
    return { providerMessageId: `provider-${channel.type}` };
  }
}

class RecordingMessage<T> implements Message<T> {
  readonly id: string;
  readonly timestamp = new Date(0);
  readonly attempts: number;
  readonly body: T;
  readonly retryOptions: QueueRetryOptions[] = [];
  ackCount = 0;

  constructor(id: string, body: T, attempts = 1) {
    this.id = id;
    this.body = body;
    this.attempts = attempts;
  }

  retry(options: QueueRetryOptions = {}): void {
    this.retryOptions.push(options);
  }

  ack(): void {
    this.ackCount += 1;
  }
}

async function channel(
  id: string,
  type: ChannelType,
  enabled = true,
): Promise<NotificationChannel> {
  const config =
    type === "EMAIL"
      ? { emails: ["ops@example.com"] }
      : { phoneNumber: "+34600123456" };
  return {
    id,
    workspaceId: "ws_1",
    name: `${type} channel`,
    type,
    encryptedConfig: await encryptSecret(
      JSON.stringify(config),
      ENCRYPTION_KEY,
    ),
    enabled,
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
  return {
    kind: "notify",
    deliveryId,
    workspaceId: "ws_1",
    channelId,
    message: MESSAGE,
  };
}

function consumerFixture() {
  const channels = new FakeChannelRepo();
  const deliveries = new FakeDeliveryRepo();
  const sender = new SelectiveSender();
  const incidents = new RecordingIncidentEvents();
  const clock = new FixedClock(5_000);
  const consumer = new SendQueuedNotification(
    deliveries,
    channels,
    sender,
    incidents,
    ENCRYPTION_KEY,
    clock,
  );
  return { channels, deliveries, sender, incidents, clock, consumer };
}

describe("SendQueuedNotification", () => {
  it.each([
    {
      boundary: "channel status",
      channels: () => new FailOnceChannelRepo(),
      incidents: () => new RecordingIncidentEvents(),
    },
    {
      boundary: "incident event",
      channels: () => new FakeChannelRepo(),
      incidents: () => new FailOnceIncidentEvents(),
    },
  ])(
    "reconciles terminal delivery after a $boundary failure without resending",
    async ({ channels, incidents }) => {
      const channelRepo = channels();
      const deliveryRepo = new FakeDeliveryRepo();
      const sender = new SelectiveSender();
      const eventWriter = incidents();
      const clock = new FixedClock(5_000);
      const consumer = new SendQueuedNotification(
        deliveryRepo,
        channelRepo,
        sender,
        eventWriter,
        ENCRYPTION_KEY,
        clock,
      );
      await channelRepo.insert(await channel("ch_reconcile", "EMAIL"));
      await deliveryRepo.insert(delivery("del_reconcile", "ch_reconcile"));
      const body = notify("del_reconcile", "ch_reconcile");

      await expect(
        consumer.execute(body, new RecordingMessage("msg_first", body)),
      ).rejects.toThrow();
      await expect(
        deliveryRepo.findById("ws_1", "del_reconcile"),
      ).resolves.toMatchObject({ status: "SENT", attemptCount: 1 });

      const replay = new RecordingMessage("msg_replay", body, 2);
      await consumer.execute(body, replay);

      expect(replay.ackCount).toBe(1);
      expect(sender.calls).toEqual(["EMAIL"]);
      await expect(
        channelRepo.findById("ws_1", "ch_reconcile"),
      ).resolves.toMatchObject({
        lastDeliveryStatus: "SENT",
        verifiedAt: 5_000,
      });
      expect(eventWriter.events).toEqual([
        expect.objectContaining({
          deliveryId: "del_reconcile",
          type: "NOTIFICATION_SENT",
        }),
      ]);
    },
  );

  it("retries with backoff twice, then records a sanitized terminal failure", async () => {
    const fixture = consumerFixture();
    await fixture.channels.insert(await channel("ch_email", "EMAIL"));
    await fixture.deliveries.insert(delivery("del_email", "ch_email"));
    fixture.sender.failures.add("EMAIL");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const first = new RecordingMessage("msg_1", notify("del_email", "ch_email"));
    await fixture.consumer.execute(first.body, first);
    expect(first.retryOptions).toEqual([{ delaySeconds: 30 }]);
    expect(first.ackCount).toBe(0);
    await expect(
      fixture.deliveries.findById("ws_1", "del_email"),
    ).resolves.toMatchObject({ status: "PENDING", attemptCount: 1 });

    const second = new RecordingMessage("msg_1", first.body, 2);
    await fixture.consumer.execute(second.body, second);
    expect(second.retryOptions).toEqual([{ delaySeconds: 60 }]);
    await expect(
      fixture.deliveries.findById("ws_1", "del_email"),
    ).resolves.toMatchObject({ status: "PENDING", attemptCount: 2 });

    const third = new RecordingMessage("msg_1", first.body, 3);
    await fixture.consumer.execute(third.body, third);
    expect(third.retryOptions).toEqual([]);
    expect(third.ackCount).toBe(1);
    await expect(
      fixture.deliveries.findById("ws_1", "del_email"),
    ).resolves.toMatchObject({
      status: "FAILED",
      attemptCount: 3,
      errorSanitized: "provider unavailable",
    });
    await expect(
      fixture.channels.findById("ws_1", "ch_email"),
    ).resolves.toMatchObject({ lastDeliveryStatus: "FAILED" });
    expect(fixture.incidents.events).toEqual([
      expect.objectContaining({
        type: "NOTIFICATION_FAILED",
        deliveryId: "del_email",
        status: "FAILED",
      }),
    ]);
    expect(log.mock.calls.join(" ")).toContain(
      '"event":"notification_delivery_failed"',
    );
    log.mockRestore();
  });

  it("redacts decrypted channel config values from delivery errors and logs", async () => {
    const fixture = consumerFixture();
    const rawConfigValue = "ops@example.com";
    await fixture.channels.insert(await channel("ch_config_error", "EMAIL"));
    await fixture.deliveries.insert(
      delivery("del_config_error", "ch_config_error"),
    );
    fixture.sender.failures.add("EMAIL");
    fixture.sender.failureMessage = `Provider rejected ${rawConfigValue}`;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const body = notify("del_config_error", "ch_config_error");

    await fixture.consumer.execute(
      body,
      new RecordingMessage("msg_config_1", body, 1),
    );
    await fixture.consumer.execute(
      body,
      new RecordingMessage("msg_config_2", body, 2),
    );
    await fixture.consumer.execute(
      body,
      new RecordingMessage("msg_config_3", body, 3),
    );

    const stored = await fixture.deliveries.findById(
      "ws_1",
      "del_config_error",
    );
    expect(stored?.errorSanitized).toContain("{{CHANNEL_CONFIG_");
    expect(stored?.errorSanitized).not.toContain(rawConfigValue);
    expect(JSON.stringify(log.mock.calls)).not.toContain(rawConfigValue);
    log.mockRestore();
  });

  it("marks a removed or disabled channel failed and acknowledges it", async () => {
    const fixture = consumerFixture();
    await fixture.channels.insert(await channel("ch_disabled", "EMAIL", false));
    await fixture.deliveries.insert(delivery("del_disabled", "ch_disabled"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const message = new RecordingMessage(
      "msg_disabled",
      notify("del_disabled", "ch_disabled"),
    );

    await fixture.consumer.execute(message.body, message);

    expect(message.ackCount).toBe(1);
    expect(fixture.sender.calls).toEqual([]);
    await expect(
      fixture.deliveries.findById("ws_1", "del_disabled"),
    ).resolves.toMatchObject({
      status: "FAILED",
      errorSanitized: "channel removed",
    });
    expect(fixture.incidents.events[0]).toMatchObject({
      type: "NOTIFICATION_FAILED",
      channelName: "EMAIL channel",
    });
    log.mockRestore();
  });

  it("isolates channel outcomes within the same queue batch", async () => {
    const fixture = consumerFixture();
    await fixture.channels.insert(await channel("ch_email", "EMAIL"));
    await fixture.channels.insert(await channel("ch_sms", "SMS"));
    await fixture.deliveries.insert(delivery("del_email", "ch_email"));
    await fixture.deliveries.insert(delivery("del_sms", "ch_sms"));
    fixture.sender.failures.add("EMAIL");
    const emailMessage = new RecordingMessage(
      "msg_email",
      notify("del_email", "ch_email"),
    );
    const smsMessage = new RecordingMessage(
      "msg_sms",
      notify("del_sms", "ch_sms"),
    );
    const batch = {
      queue: "zenguy-notify",
      messages: [emailMessage, smsMessage],
      metadata: { metrics: { backlogCount: 2, backlogBytes: 1 } },
      retryAll: () => undefined,
      ackAll: () => undefined,
    } satisfies MessageBatch<unknown>;

    await processNotifyBatch(batch, fixture.consumer);

    await expect(
      fixture.deliveries.findById("ws_1", "del_email"),
    ).resolves.toMatchObject({ status: "PENDING", attemptCount: 1 });
    await expect(
      fixture.deliveries.findById("ws_1", "del_sms"),
    ).resolves.toMatchObject({
      status: "SENT",
      attemptCount: 1,
      providerMessageId: "provider-SMS",
      sentAt: 5_000,
    });
    expect(emailMessage.retryOptions).toEqual([{ delaySeconds: 30 }]);
    expect(smsMessage.ackCount).toBe(1);
    await expect(
      fixture.channels.findById("ws_1", "ch_sms"),
    ).resolves.toMatchObject({
      lastDeliveryStatus: "SENT",
      verifiedAt: 5_000,
    });
    expect(fixture.incidents.events).toEqual([
      expect.objectContaining({
        type: "NOTIFICATION_SENT",
        channelId: "ch_sms",
      }),
    ]);
  });

  it("retries a leased PENDING delivery and sends it after the crash lease expires", async () => {
    const fixture = consumerFixture();
    await fixture.channels.insert(await channel("ch_email", "EMAIL"));
    await fixture.deliveries.insert(delivery("del_leased", "ch_email"));
    fixture.deliveries.processingAt.set("del_leased", fixture.clock.now());
    const body = notify("del_leased", "ch_email");
    const busy = new RecordingMessage("msg_busy", body);

    await fixture.consumer.execute(body, busy);

    expect(busy.retryOptions).toEqual([{ delaySeconds: 30 }]);
    expect(fixture.sender.calls).toEqual([]);
    await expect(
      fixture.deliveries.findById("ws_1", "del_leased"),
    ).resolves.toMatchObject({ status: "PENDING", attemptCount: 0 });

    fixture.clock.advance(300_001);
    const recovered = new RecordingMessage("msg_recovered", body, 2);
    await fixture.consumer.execute(body, recovered);
    expect(recovered.ackCount).toBe(1);
    expect(fixture.sender.calls).toEqual(["EMAIL"]);
    await expect(
      fixture.deliveries.findById("ws_1", "del_leased"),
    ).resolves.toMatchObject({ status: "SENT", attemptCount: 1 });
  });

  it("acknowledges poison messages and continues processing valid ones", async () => {
    const poison = new RecordingMessage("msg_bad", { nope: true });
    const valid = new RecordingMessage("msg_valid", notify("del_1", "ch_1"));
    const execute = vi.fn(async (_input: NotifyMessage, control: Pick<Message, "ack">) => {
      control.ack();
    });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const batch = {
      queue: "zenguy-notify",
      messages: [poison, valid],
      metadata: { metrics: { backlogCount: 2, backlogBytes: 1 } },
      retryAll: () => undefined,
      ackAll: () => undefined,
    } satisfies MessageBatch<unknown>;

    await processNotifyBatch(batch, { execute });

    expect(poison.ackCount).toBe(1);
    expect(valid.ackCount).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"bad_queue_message"',
    );
    alert.mockRestore();
  });
});
