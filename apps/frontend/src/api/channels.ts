import {
  apiDelete,
  apiGet,
  apiGetPage,
  apiPatch,
  apiPost,
  type ApiPage,
} from "../lib/api";
import type {
  Channel,
  ChannelConfigInput,
  ChannelType,
  Delivery,
} from "./types";

export interface CreateChannelInput {
  config: ChannelConfigInput;
  isDefault?: boolean;
  name: string;
  type: ChannelType;
}

export interface UpdateChannelInput {
  config?: ChannelConfigInput;
  enabled?: boolean;
  isDefault?: boolean;
  name?: string;
}

function channelsPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/channels`;
}

export function channelPath(workspaceId: string, channelId: string): string {
  return `${channelsPath(workspaceId)}/${encodeURIComponent(channelId)}`;
}

export function deliveriesPath(
  workspaceId: string,
  channelId: string,
  options: { cursor?: string | null; limit?: number } = {},
): string {
  const search = new URLSearchParams({ limit: String(options.limit ?? 25) });
  if (options.cursor) search.set("cursor", options.cursor);
  return `${channelPath(workspaceId, channelId)}/deliveries?${search}`;
}

export function listChannels(workspaceId: string): Promise<Channel[]> {
  return apiGet(channelsPath(workspaceId));
}

export function createChannel(
  workspaceId: string,
  input: CreateChannelInput,
): Promise<Channel> {
  return apiPost(channelsPath(workspaceId), input);
}

export function updateChannel(
  workspaceId: string,
  channelId: string,
  input: UpdateChannelInput,
): Promise<Channel> {
  return apiPatch(channelPath(workspaceId, channelId), input);
}

export function deleteChannel(workspaceId: string, channelId: string): Promise<void> {
  return apiDelete(channelPath(workspaceId, channelId));
}

export async function testChannel(
  workspaceId: string,
  channelId: string,
): Promise<Delivery> {
  const result = await apiPost<{ delivery: Delivery }>(
    `${channelPath(workspaceId, channelId)}/test`,
  );
  return result.delivery;
}

export function listDeliveries(
  workspaceId: string,
  channelId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ApiPage<Delivery>> {
  return apiGetPage(deliveriesPath(workspaceId, channelId, options));
}
