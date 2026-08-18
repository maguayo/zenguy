import { zValidator } from "@hono/zod-validator";
import type { $ZodType } from "zod/v4/core";
import { validation } from "../shared/errors";

function issuesToDetails(
  issues: readonly { path: PropertyKey[]; message: string }[],
): { field: string; message: string }[] {
  return issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function zjson<T extends $ZodType>(schema: T) {
  return zValidator("json", schema, (result) => {
    if (!result.success) {
      throw validation(issuesToDetails(result.error.issues));
    }
  });
}

export function zquery<T extends $ZodType>(schema: T) {
  return zValidator("query", schema, (result) => {
    if (!result.success) {
      throw validation(issuesToDetails(result.error.issues));
    }
  });
}
