import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { httpStatus, isAppError } from "../../shared/errors";
import { logEvent } from "../../shared/log";

export const errorHandler: ErrorHandler<AppEnv> = (error, context) => {
  if (isAppError(error)) {
    if (error.retryAfterSeconds !== undefined) {
      context.header("Retry-After", String(error.retryAfterSeconds));
    }
    const body: {
      error: {
        code: typeof error.code;
        message: string;
        details?: typeof error.details;
      };
    } = {
      error: { code: error.code, message: error.message },
    };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return context.json(
      body,
      httpStatus(error.code) as ContentfulStatusCode,
    );
  }

  logEvent("unhandled_error", { message: error.message });
  return context.json(
    { error: { code: "INTERNAL", message: "Internal error" } },
    500,
  );
};
