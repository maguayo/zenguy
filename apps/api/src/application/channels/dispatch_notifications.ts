import type {
  ChannelRepo,
} from "../../domain/channels/repo";
import type { NotificationMessage } from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type { NotificationDelivery } from "../../domain/channels/types";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import type { DurableWorkflowRepo } from "../../domain/durability/repo";
import { createOutboxEntry } from "../durability/factory";
import type { PublishQueueOutbox } from "../durability/publish_outbox";
import { platformAlert } from "../../shared/log";

export class DispatchNotifications {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly durable: Pick<
      DurableWorkflowRepo,
      "insertDeliveryWithOutbox"
    >,
    private readonly outboxPublisher: Pick<PublishQueueOutbox, "publishById">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    channelIds: string[];
    message: NotificationMessage;
    incidentId: string | null;
    dedupeKey: string;
  }): Promise<string[]> {
    const channels = (
      await this.channels.listByIds(input.workspaceId, input.channelIds)
    ).filter((channel) => channel.enabled);
    const deliveries = channels.map(async (channel) => {
      const delivery: NotificationDelivery = {
        id: this.ids.newId("del"),
        workspaceId: input.workspaceId,
        incidentId: input.incidentId,
        notificationChannelId: channel.id,
        eventType: input.message.eventType,
        status: "PENDING",
        providerMessageId: null,
        attemptCount: 0,
        errorSanitized: null,
        sentAt: null,
        createdAt: this.clock.now(),
      };
      const message: NotifyMessage = {
        kind: "notify",
        deliveryId: delivery.id,
        workspaceId: input.workspaceId,
        channelId: channel.id,
        message: input.message,
      };
      const dedupeKey = `${input.dedupeKey}:${channel.id}`;
      const outbox = createOutboxEntry({
        dedupeKey: `notify:${dedupeKey}`,
        queueKind: "NOTIFY",
        payload: message,
        availableAt: delivery.createdAt,
        now: delivery.createdAt,
        ids: this.ids,
      });
      const inserted = await this.durable.insertDeliveryWithOutbox({
        delivery,
        dedupeKey,
        outbox,
      });
      try {
        await this.outboxPublisher.publishById(inserted.outboxId);
      } catch {
        platformAlert("notification_publish_deferred", {
          deliveryId: inserted.deliveryId,
          outboxId: inserted.outboxId,
        });
      }
      return inserted.deliveryId;
    });
    return Promise.all(deliveries);
  }
}
