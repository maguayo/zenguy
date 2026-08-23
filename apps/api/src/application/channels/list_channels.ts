import type { AlertRepo } from "../../domain/alerts/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { PushDeviceRepo } from "../../domain/push/repo";
import { loadPaidChannelContext } from "../alerts/settings";
import { channelOutput, type ChannelOutput } from "./types";
import type { EncryptionKeyring } from "../../shared/crypto";
import { validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";

export const MAX_CHANNEL_LIST_PAGE = 100;

export interface ChannelPage {
  channels: ChannelOutput[];
  nextCursor: string | null;
}

export class ListChannels {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly alerts: Pick<AlertRepo, "findSettings" | "getBalanceCents">,
    private readonly encryptionKeys: EncryptionKeyring,
    private readonly pushDevices: Pick<PushDeviceRepo, "reachForWorkspace">,
  ) {}

  async execute(input: {
    workspaceId: string;
    cursor?: string;
    limit?: number;
  }): Promise<ChannelPage> {
    const limit = input.limit ?? MAX_CHANNEL_LIST_PAGE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANNEL_LIST_PAGE) {
      throw validation([
        {
          field: "limit",
          message: `Must be an integer between 1 and ${MAX_CHANNEL_LIST_PAGE}`,
        },
      ]);
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const [rows, paid] = await Promise.all([
      this.channels.listPage(input.workspaceId, cursor, limit + 1),
      loadPaidChannelContext(this.alerts, input.workspaceId),
    ]);
    const channels = rows.slice(0, limit);
    const reach = channels.some((channel) => channel.type === "PUSH")
      ? await this.pushDevices.reachForWorkspace(input.workspaceId)
      : null;
    const output = await Promise.all(
      channels.map((channel) =>
        channelOutput(channel, this.encryptionKeys, paid, reach),
      ),
    );
    const last = channels.at(-1);
    return {
      channels: output,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
