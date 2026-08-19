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

class RecordingQueue implements Pick<Queue<NotifyMessage>, "send"> {
  readonly messages: NotifyMessage[] = [];

  async send(
    message: NotifyMessage,
    _options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
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
    const dispatch = new DispatchNotifications(
      channels,
      deliveries,
      queue,
      new FixedClock(1_000),
      new FakeIds(),
    );

    const ids = await dispatch.execute({
      workspaceId: "ws_1",
      channelIds: ["ch_email", "ch_sms", "ch_disabled", "ch_missing"],
      message: MESSAGE,
      incidentId: "inc_1",
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
});
