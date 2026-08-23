import { processNotifyBatch } from "../../index";
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
import { FixedClock } from "../../shared/clock";
import { createEncryptionKeyring, encryptSecret } from "../../shared/crypto";
import { FakeTrackEvent } from "../../test/fakes/activity";
import {
  FakeChannelRepo,
  FakeDeliveryRepo,
} from "../../test/fakes/repos";
import type {
  IncidentEventWriter,
  IncidentNotificationEvent,
} from "./incident_event_writer";
import { ROW_DESTINATION } from "../../domain/alerts/pricing";
import type { PaidDeliveryCharger } from "../alerts/charge_paid_delivery";
import { SendQueuedNotification } from "./send_queued_notification";

const allowAllCharger: PaidDeliveryCharger = {
  charge: async () => ({
    ok: true,
    costCents: 0,
    destination: ROW_DESTINATION,
    replayed: false,
  }),
  refund: async () => false,
};

const ENCRYPTION_KEY = new Uint8Array(32).fill(9);
const ENCRYPTION_KEYS = createEncryptionKeyring({
  id: "test-notify-queue",
  key: ENCRYPTION_KEY,
});
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
  failureOutcome: "REJECTED" | "AMBIGUOUS" = "REJECTED";

  async send(
    channel: { type: ChannelType; config: unknown },
  ): Promise<{ providerMessageId: string | null }> {
    this.calls.push(channel.type);
    if (this.failures.has(channel.type)) {
      throw this.failureOutcome === "REJECTED"
        ? providerRejected(this.failureMessage)
        : providerAmbiguous(this.failureMessage);
    }
    return { providerMessageId: `provider-${channel.type}` };
  }
}

class GatedSender implements ChannelSender {
  readonly contexts: Array<{
    deliveryId: string;
    idempotencyKey: string;
    attemptCount: number;
  }> = [];
  private readonly gate: Promise<void>;
  private releaseGate!: () => void;
  readonly started: Promise<void>;
  private markStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  release(): void {
    this.releaseGate();
  }

  async send(
    _channel: { type: ChannelType; config: unknown },
    _message: NotificationMessage,
    context: {
      deliveryId: string;
      idempotencyKey: string;
      attemptCount: number;
    },
  ): Promise<{ providerMessageId: string | null }> {
    this.contexts.push({ ...context });
    this.markStarted();
    await this.gate;
    return { providerMessageId: "provider-gated" };
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
      : type === "SMS"
        ? { phoneNumber: "+34600123456", consent: true }
        : { phoneNumber: "+34600123456" };
  return {
    id,
    workspaceId: "ws_1",
    name: `${type} channel`,
    type,
    encryptedConfig: await encryptSecret(
      JSON.stringify(config),
      ENCRYPTION_KEYS,
      { type: "notification_channel", workspaceId: "ws_1", recordId: id },
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
  const track = new FakeTrackEvent();
  const consumer = new SendQueuedNotification(
    deliveries,
    channels,
    sender,
    incidents,
    ENCRYPTION_KEYS,
    clock,
    allowAllCharger,
    undefined,
    track,
  );
  return { channels, deliveries, sender, incidents, clock, track, consumer };
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
      const track = new FakeTrackEvent();
      const consumer = new SendQueuedNotification(
        deliveryRepo,
        channelRepo,
        sender,
        eventWriter,
        ENCRYPTION_KEYS,
        clock,
        allowAllCharger,
        undefined,
        track,
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
      // The replay only reconciles local effects; the alert was sent once.
      expect(track.ofType("alert.sent")).toHaveLength(1);
      expect(track.calls).toHaveLength(1);
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
    // Retries are not terminal: nothing is recorded yet.
    expect(fixture.track.calls).toEqual([]);

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
    expect(fixture.track.ofType("alert.sent")).toEqual([]);
    expect(fixture.track.ofType("alert.failed")).toEqual([
      expect.objectContaining({
        userId: null,
        workspaceId: "ws_1",
        source: "server",
        resourceId: "del_email",
        properties: {
          channelId: "ch_email",
          channelType: "EMAIL",
          incidentId: "inc_1",
        },
      }),
    ]);
    expect(fixture.track.calls).toHaveLength(1);
    log.mockRestore();
  });

  it("stops after an ambiguous provider outcome and never resends on replay", async () => {
    const fixture = consumerFixture();
    await fixture.channels.insert(await channel("ch_ambiguous", "EMAIL"));
    await fixture.deliveries.insert(delivery("del_ambiguous", "ch_ambiguous"));
    fixture.sender.failures.add("EMAIL");
    fixture.sender.failureOutcome = "AMBIGUOUS";
    const body = notify("del_ambiguous", "ch_ambiguous");
    const first = new RecordingMessage("msg_ambiguous", body);

    await fixture.consumer.execute(body, first);

    expect(first.ackCount).toBe(1);
    expect(first.retryOptions).toEqual([]);
    await expect(
      fixture.deliveries.findById("ws_1", "del_ambiguous"),
    ).resolves.toMatchObject({
      status: "PENDING",
      dispatchState: "AMBIGUOUS",
      attemptCount: 1,
      errorSanitized: "provider unavailable",
      providerIdempotencyKey: "del_ambiguous",
    });

    const replay = new RecordingMessage("msg_ambiguous_replay", body, 2);
    await fixture.consumer.execute(body, replay);
    expect(replay.ackCount).toBe(1);
    expect(fixture.sender.calls).toEqual(["EMAIL"]);
    // An ambiguous outcome is neither sent nor failed.
    expect(fixture.track.calls).toEqual([]);
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
    expect(fixture.track.ofType("alert.failed")).toEqual([
      expect.objectContaining({
        userId: null,
        workspaceId: "ws_1",
        source: "server",
        resourceId: "del_disabled",
        properties: {
          channelId: "ch_disabled",
          channelType: "EMAIL",
          incidentId: "inc_1",
        },
      }),
    ]);
    expect(fixture.track.calls).toHaveLength(1);
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
    expect(fixture.track.ofType("alert.sent")).toEqual([
      expect.objectContaining({
        userId: null,
        workspaceId: "ws_1",
        source: "server",
        resourceId: "del_sms",
        properties: {
          channelId: "ch_sms",
          channelType: "SMS",
          incidentId: "inc_1",
        },
      }),
    ]);
    expect(fixture.track.ofType("alert.failed")).toEqual([]);
    expect(fixture.track.calls).toHaveLength(1);
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

  it("fences concurrent workers and lets late provider evidence resolve an ambiguous lease", async () => {
    const channels = new FakeChannelRepo();
    const deliveries = new FakeDeliveryRepo();
    const sender = new GatedSender();
    const incidents = new RecordingIncidentEvents();
    const clock = new FixedClock(5_000);
    const consumer = new SendQueuedNotification(
      deliveries,
      channels,
      sender,
      incidents,
      ENCRYPTION_KEYS,
      clock,
      allowAllCharger,
    );
    await channels.insert(await channel("ch_fenced", "EMAIL"));
    await deliveries.insert(delivery("del_fenced", "ch_fenced"));
    const body = notify("del_fenced", "ch_fenced");
    const ownerMessage = new RecordingMessage("msg_owner", body);
    const owner = consumer.execute(body, ownerMessage);
    await sender.started;

    const concurrent = new RecordingMessage("msg_concurrent", body, 2);
    await consumer.execute(body, concurrent);
    expect(concurrent.retryOptions).toEqual([{ delaySeconds: 30 }]);
    expect(sender.contexts).toEqual([
      {
        deliveryId: "del_fenced",
        idempotencyKey: "del_fenced",
        attemptCount: 1,
      },
    ]);

    clock.advance(300_001);
    const takeover = new RecordingMessage("msg_takeover", body, 3);
    await consumer.execute(body, takeover);
    expect(takeover.ackCount).toBe(1);
    await expect(deliveries.findById("ws_1", "del_fenced")).resolves.toMatchObject({
      status: "PENDING",
      dispatchState: "AMBIGUOUS",
    });

    sender.release();
    await owner;
    await expect(deliveries.findById("ws_1", "del_fenced")).resolves.toMatchObject({
      status: "SENT",
      dispatchState: "CONFIRMED",
      providerMessageId: "provider-gated",
    });
    expect(sender.contexts).toHaveLength(1);
  });

  it("does not let a duplicate observing a disabled channel overwrite an active dispatch", async () => {
    const channels = new FakeChannelRepo();
    const deliveries = new FakeDeliveryRepo();
    const sender = new GatedSender();
    const incidents = new RecordingIncidentEvents();
    const clock = new FixedClock(5_000);
    const consumer = new SendQueuedNotification(
      deliveries,
      channels,
      sender,
      incidents,
      ENCRYPTION_KEYS,
      clock,
      allowAllCharger,
    );
    await channels.insert(await channel("ch_disable_race", "EMAIL"));
    await deliveries.insert(delivery("del_disable_race", "ch_disable_race"));
    const body = notify("del_disable_race", "ch_disable_race");
    const owner = consumer.execute(
      body,
      new RecordingMessage("msg_disable_owner", body),
    );
    await sender.started;

    await channels.update("ch_disable_race", { enabled: false }, clock.now());
    const duplicate = new RecordingMessage("msg_disable_duplicate", body, 2);
    await consumer.execute(body, duplicate);

    expect(duplicate.ackCount).toBe(1);
    await expect(
      deliveries.findById("ws_1", "del_disable_race"),
    ).resolves.toMatchObject({
      status: "PENDING",
      dispatchState: "DISPATCHING",
    });

    sender.release();
    await owner;
    await expect(
      deliveries.findById("ws_1", "del_disable_race"),
    ).resolves.toMatchObject({
      status: "SENT",
      dispatchState: "CONFIRMED",
      providerMessageId: "provider-gated",
    });
    expect(sender.contexts).toHaveLength(1);
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
