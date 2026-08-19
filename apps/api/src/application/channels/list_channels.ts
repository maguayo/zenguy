import type { ChannelRepo } from "../../domain/channels/repo";
import { channelOutput, type ChannelOutput } from "./types";

export class ListChannels {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly encryptionKey: Uint8Array,
  ) {}

  async execute(input: { workspaceId: string }): Promise<ChannelOutput[]> {
    return Promise.all(
      (await this.channels.list(input.workspaceId)).map((channel) =>
        channelOutput(channel, this.encryptionKey),
      ),
    );
  }
}
