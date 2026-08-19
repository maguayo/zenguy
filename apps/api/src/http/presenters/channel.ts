import type {
  ChannelOutput,
  DeliveryOutput,
} from "../../application/channels/types";

export function presentChannel(channel: ChannelOutput) {
  return {
    ...channel,
    verifiedAt:
      channel.verifiedAt === null
        ? null
        : new Date(channel.verifiedAt).toISOString(),
    createdAt: new Date(channel.createdAt).toISOString(),
  };
}

export function presentDelivery(delivery: DeliveryOutput) {
  return {
    ...delivery,
    sentAt:
      delivery.sentAt === null
        ? null
        : new Date(delivery.sentAt).toISOString(),
    createdAt: new Date(delivery.createdAt).toISOString(),
  };
}
