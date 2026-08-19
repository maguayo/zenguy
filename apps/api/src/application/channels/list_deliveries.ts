import type {
  ChannelRepo,
  DeliveryRepo,
} from "../../domain/channels/repo";
import { notFound, validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";
import { deliveryOutput, type DeliveryOutput } from "./types";

export interface DeliveryPage {
  deliveries: DeliveryOutput[];
  nextCursor: string | null;
}

export class ListDeliveries {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly deliveries: DeliveryRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    channelId: string;
    cursor?: string;
    limit?: number;
  }): Promise<DeliveryPage> {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw validation([
        { field: "limit", message: "Must be an integer between 1 and 100" },
      ]);
    }
    if (
      (await this.channels.findById(input.workspaceId, input.channelId)) ===
      null
    ) {
      throw notFound("Notification channel");
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.deliveries.listForChannel(
      input.channelId,
      cursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      deliveries: page.map(deliveryOutput),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
