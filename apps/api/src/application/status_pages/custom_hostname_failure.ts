import { CustomHostnameApiError } from "../../infrastructure/cloudflare/custom_hostnames";
import { conflict, unavailable } from "../../shared/errors";
import { logEvent, platformAlert } from "../../shared/log";

/**
 * Translates Cloudflare custom hostname API failures into client-safe errors.
 * Auth failures are a platform misconfiguration (token scope or rotation), so
 * they alert operators; other rejections carry Cloudflare's reason back to the
 * workspace admin, who is the one able to act on it.
 */
export function rethrowCustomHostnameFailure(
  error: unknown,
  operation: "create" | "get",
): never {
  if (!(error instanceof CustomHostnameApiError)) throw error;
  if (error.status === 401 || error.status === 403) {
    platformAlert("custom_domain.cloudflare_auth_failed", {
      operation,
      status: error.status,
      message: error.message,
    });
    throw unavailable("Custom domains are temporarily unavailable");
  }
  logEvent("custom_domain.cloudflare_error", {
    operation,
    status: error.status,
    message: error.message,
  });
  if (error.status >= 500) {
    throw unavailable(
      "Cloudflare could not process the domain right now — try again in a minute",
    );
  }
  throw conflict(`Cloudflare rejected this domain: ${error.message}`);
}
