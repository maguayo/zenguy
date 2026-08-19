import type {
  ChannelRepo,
  DeliveryRepo,
} from "../../domain/channels/repo";
import type { NotificationMessage } from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type { NotificationDelivery } from "../../domain/channels/types";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";

export class DispatchNotifications {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly deliveries: DeliveryRepo,
    private readonly queue: Pick<Queue<NotifyMessage>, "send">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    channelIds: string[];
    message: NotificationMessage;
    incidentId: string | null;
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
      await this.deliveries.insert(delivery);
      await this.queue.send({
        kind: "notify",
        deliveryId: delivery.id,
        workspaceId: input.workspaceId,
        channelId: channel.id,
        message: input.message,
      });
      return delivery.id;
    });
    return Promise.all(deliveries);
  }
}
