import type { EmailSender } from "../../domain/email/sender";
import type { AppConfig } from "../../shared/config";
import { DevEmailSender } from "./dev";
import { ResendEmailSender } from "./resend";

export function buildEmailSender(
  config: Pick<AppConfig, "resendApiKey" | "emailFrom">,
  fetchFn: typeof fetch = globalThis.fetch,
): EmailSender {
  return config.resendApiKey.trim() === ""
    ? new DevEmailSender()
    : new ResendEmailSender(config.resendApiKey, config.emailFrom, fetchFn);
}
