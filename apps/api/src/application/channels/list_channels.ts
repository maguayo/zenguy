import type { AlertRepo } from "../../domain/alerts/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import { loadPaidChannelContext } from "../alerts/settings";
import { channelOutput, type ChannelOutput } from "./types";

export class ListChannels {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly alerts: Pick<AlertRepo, "findSettings" | "getBalanceCents">,
    private readonly encryptionKey: Uint8Array,
  ) {}

  async execute(input: { workspaceId: string }): Promise<ChannelOutput[]> {
    const [channels, paid] = await Promise.all([
      this.channels.list(input.workspaceId),
      loadPaidChannelContext(this.alerts, input.workspaceId),
    ]);
    return Promise.all(
      channels.map((channel) =>
        channelOutput(channel, this.encryptionKey, paid),
      ),
    );
  }
}
