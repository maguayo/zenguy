import type { ChannelRepo } from "../../domain/channels/repo";
import {
  browserTestConfigSchema,
  browserTestConfigUpdateSchema,
  type BrowserTestConfig,
} from "../../domain/browser_tests/rules";
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

export function parseBrowserTestConfig(value: unknown): BrowserTestConfig {
  const result = browserTestConfigSchema.safeParse(value);
  return result.success ? result.data : configValidation(result.error);
}

export type BrowserTestConfigUpdate = Partial<BrowserTestConfig>;

export function parseBrowserTestUpdate(
  value: unknown,
): BrowserTestConfigUpdate {
  const result = browserTestConfigUpdateSchema.safeParse(value);
  if (!result.success) return configValidation(result.error);
  if (Object.keys(result.data).length === 0) {
    throw validation([
      { field: "body", message: "At least one field is required" },
    ]);
  }
  return result.data;
}

export async function validateChannelIds(
  channels: ChannelRepo,
  workspaceId: string,
  channelIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(channelIds)];
  const found = await channels.listByIds(workspaceId, uniqueIds);
  const foundIds = new Set(found.map(({ id }) => id));
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
