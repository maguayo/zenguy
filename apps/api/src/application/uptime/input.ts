import type { ChannelRepo } from "../../domain/channels/repo";
import {
  monitorConfigSchema,
  monitorConfigUpdateSchema,
  type MonitorConfig,
  type MonitorConfigUpdate,
} from "../../domain/uptime/rules";
import { validation } from "../../shared/errors";

function configValidation(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): never {
  throw validation(
    error.issues.map((issue) => ({
      field: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}

export function parseMonitorConfig(value: unknown): MonitorConfig {
  const result = monitorConfigSchema.safeParse(value);
  return result.success ? result.data : configValidation(result.error);
}

export function parseMonitorUpdate(value: unknown): MonitorConfigUpdate {
  const result = monitorConfigUpdateSchema.safeParse(value);
  if (!result.success) return configValidation(result.error);
  if (Object.keys(result.data).length === 0) {
    throw validation([
      { field: "body", message: "At least one field is required" },
    ]);
  }
  return result.data;
}

export function parseMonitorTestRequest(value: unknown): MonitorConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation([{ field: "body", message: "Expected an object" }]);
  }
  const record = value as Record<string, unknown>;
  return parseMonitorConfig({
    ...record,
    ...(record.name === undefined ? { name: "Test request" } : {}),
  });
}

export async function validateMonitorChannelIds(
  channels: Pick<ChannelRepo, "listByIds">,
  workspaceId: string,
  channelIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(channelIds)];
  const found = await channels.listByIds(workspaceId, uniqueIds);
  const foundIds = new Set(found.map((channel) => channel.id));
  if (uniqueIds.some((id) => !foundIds.has(id))) {
    throw validation([
      {
        field: "channelIds",
        message: "Every channel must belong to this workspace",
      },
    ]);
  }
  return uniqueIds;
}
