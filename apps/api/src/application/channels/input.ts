import type { ChannelConfig, ChannelType } from "../../domain/channels/types";
import { channelConfigSchema } from "../../domain/channels/types";
import { validation } from "../../shared/errors";

export function channelName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw validation([
      { field: "name", message: "Must be between 1 and 80 characters" },
    ]);
  }
  return name;
}

export function parseChannelConfig(
  type: ChannelType,
  value: unknown,
): ChannelConfig {
  const parsed = channelConfigSchema(type).safeParse(value);
  if (!parsed.success) {
    throw validation(
      parsed.error.issues.map((issue) => ({
        field: ["config", ...issue.path.map(String)].join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
