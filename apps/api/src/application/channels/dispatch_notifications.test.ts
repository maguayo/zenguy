import type { NotificationMessage } from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type { NotificationChannel } from "../../domain/channels/types";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeChannelRepo,
  FakeDeliveryRepo,
} from "../../test/fakes/repos";
import { DispatchNotifications } from "./dispatch_notifications";
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { PublishQueueOutbox } from "../durability/publish_outbox";

class RecordingQueue implements Pick<Queue<NotifyMessage>, "send"> {
  readonly messages: NotifyMessage[] = [];
  failures = 0;

  async send(
    message: NotifyMessage,
    _options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("queue unavailable");
    }
    this.messages.push(structuredClone(message));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

const MESSAGE: NotificationMessage = {
  eventType: "FAILURE",
  title: "❌ Checkout failed",
  lines: ["Checkout failed after all configured retries."],
  link: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
  speakText: "Zenguy alert. Checkout failed.",
  shortText: "Zenguy: FAILED Checkout.",
  color: "red",
};

function channel(
  id: string,
  enabled: boolean,
  createdAt: number,
): NotificationChannel {
  return {
    id,
    workspaceId: "ws_1",
    name: id,
    type: "EMAIL",
    encryptedConfig: "encrypted",
    enabled,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: "usr_1",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("DispatchNotifications", () => {
  it("creates one pending delivery and queue message per enabled channel", async () => {
    const channels = new FakeChannelRepo();
    const deliveries = new FakeDeliveryRepo();
    const queue = new RecordingQueue();
    await channels.insert(channel("ch_email", true, 1));
    await channels.insert(channel("ch_sms", true, 2));
    await channels.insert(channel("ch_disabled", false, 3));
    const clock = new FixedClock(1_000);
    const durable = new FakeDurableWorkflowRepo({ deliveries });
    const unusedQueue = {
      send: async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    };
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: unusedQueue, CHECK: unusedQueue, NOTIFY: queue },
      clock,
    );
    const dispatch = new DispatchNotifications(
      channels,
      durable,
      publisher,
      clock,
      new FakeIds(),
    );

    const ids = await dispatch.execute({
      workspaceId: "ws_1",
      channelIds: ["ch_email", "ch_sms", "ch_disabled", "ch_missing"],
      message: MESSAGE,
      incidentId: "inc_1",
      dedupeKey: "incident:inc_1:failure",
    });

    expect(ids).toHaveLength(2);
    expect([...deliveries.deliveries.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids[0],
          status: "PENDING",
          eventType: "FAILURE",
          incidentId: "inc_1",
          attemptCount: 0,
        }),
        expect.objectContaining({
          id: ids[1],
          status: "PENDING",
          eventType: "FAILURE",
          incidentId: "inc_1",
          attemptCount: 0,
        }),
      ]),
    );
    expect(queue.messages).toHaveLength(2);
    expect(queue.messages.map(({ channelId }) => channelId).sort()).toEqual([
      "ch_email",
      "ch_sms",
    ]);
    expect(queue.messages.every(({ message }) => message === MESSAGE)).toBe(
      false,
    );
    expect(queue.messages.map(({ message }) => message)).toEqual([
      MESSAGE,
      MESSAGE,
    ]);
  });

  it("isolates Queue.send failures and replays each pending delivery once", async () => {
    const channels = new FakeChannelRepo();
    const deliveries = new FakeDeliveryRepo();
    const queue = new RecordingQueue();
    const clock = new FixedClock(1_000);
    await channels.insert(channel("ch_email", true, 1));
    await channels.insert(channel("ch_sms", true, 2));
    const durable = new FakeDurableWorkflowRepo({ deliveries });
    const unusedQueue = {
      send: async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    };
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: unusedQueue, CHECK: unusedQueue, NOTIFY: queue },
      clock,
    );
    const dispatch = new DispatchNotifications(
      channels,
      durable,
      publisher,
      clock,
      new FakeIds(),
    );
    queue.failures = 1;
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = {
      workspaceId: "ws_1",
      channelIds: ["ch_email", "ch_sms"],
      message: MESSAGE,
      incidentId: "inc_1",
      dedupeKey: "incident:inc_1:failure",
    };

    const ids = await dispatch.execute(input);

    expect(ids).toHaveLength(2);
    expect(deliveries.deliveries.size).toBe(2);
    expect(queue.messages).toHaveLength(1);
    expect(
      [...durable.outboxEntries.values()].filter(
        (entry) => entry.publishedAt === null,
      ),
    ).toHaveLength(1);
    await expect(publisher.flush()).resolves.toEqual({
      published: 1,
      failed: 0,
    });
    expect(queue.messages.map((message) => message.channelId).sort()).toEqual([
      "ch_email",
      "ch_sms",
    ]);

    await expect(dispatch.execute(input)).resolves.toEqual(ids);
    expect(deliveries.deliveries.size).toBe(2);
    expect(queue.messages).toHaveLength(2);
    alert.mockRestore();
  });
});
