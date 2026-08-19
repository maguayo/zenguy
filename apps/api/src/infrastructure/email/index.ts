import type { EmailSender } from "../../domain/email/sender";
import type { AppConfig } from "../../shared/config";
import { CloudflareEmailSender } from "./cloudflare";

export function buildEmailSender(
  config: Pick<AppConfig, "emailFrom">,
  binding: SendEmail,
): EmailSender {
  return new CloudflareEmailSender(binding, config.emailFrom);
}
