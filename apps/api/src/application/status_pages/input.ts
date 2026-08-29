import {
  statusPageConfigSchema,
  statusPageItemConfigSchema,
  statusPageItemUpdateSchema,
  statusPageUpdateSchema,
  type StatusPageConfig,
  type StatusPageConfigUpdate,
  type StatusPageItemConfig,
  type StatusPageItemConfigUpdate,
} from "../../domain/status_pages/rules";
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

function requireSomeField(data: Record<string, unknown>): void {
  if (Object.keys(data).length === 0) {
    throw validation([
      { field: "body", message: "At least one field is required" },
    ]);
  }
}

export function parseStatusPageConfig(value: unknown): StatusPageConfig {
  const result = statusPageConfigSchema.safeParse(value);
  return result.success ? result.data : configValidation(result.error);
}

export function parseStatusPageUpdate(value: unknown): StatusPageConfigUpdate {
  const result = statusPageUpdateSchema.safeParse(value);
  if (!result.success) return configValidation(result.error);
  requireSomeField(result.data);
  return result.data;
}

export function parseStatusPageItemConfig(
  value: unknown,
): StatusPageItemConfig {
  const result = statusPageItemConfigSchema.safeParse(value);
  return result.success ? result.data : configValidation(result.error);
}

export function parseStatusPageItemUpdate(
  value: unknown,
): StatusPageItemConfigUpdate {
  const result = statusPageItemUpdateSchema.safeParse(value);
  if (!result.success) return configValidation(result.error);
  requireSomeField(result.data);
  return result.data;
}
