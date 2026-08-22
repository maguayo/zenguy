import type {
  ChannelSender,
  NotificationMessage,
} from "../../domain/channels/notifier";
import {
  discordChannelConfigSchema,
  emailChannelConfigSchema,
  phoneChannelConfigSchema,
  pushChannelConfigSchema,
  smsChannelConfigSchema,
  slackChannelConfigSchema,
} from "../../domain/channels/types";
import { smsBody } from "../../domain/alerts/sms";
import type { EmailSender } from "../../domain/email/sender";
import type { PushDeviceRepo } from "../../domain/push/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { DiscordWebhookSender } from "./discord";
import { ExpoPushClient, ExpoPushSender, type ExpoFetch } from "./expo_push";
import { EmailNotificationSender } from "./email_sender";
import { SlackWebhookSender } from "./slack";
import { speechTwiml, TwilioApi, type TwilioFetch } from "./twilio";

export interface PushSenderOptions {
  devices: Pick<PushDeviceRepo, "listEnabledTokensForWorkspace" | "disableTokens">;
  appUrl: string;
  accessToken: string | null;
  clock: Clock;
  fetchFn?: ExpoFetch;
}

export function buildChannelSender(
  config: Pick<AppConfig, "twilio">,
  emailSender: EmailSender,
  fetchFn: TwilioFetch = fetch,
  push: PushSenderOptions | null = null,
): ChannelSender {
  const email = new EmailNotificationSender(emailSender);
  const twilio = new TwilioApi(
    config.twilio.accountSid,
    config.twilio.authToken,
    fetchFn,
  );
  const slack = new SlackWebhookSender(fetchFn);
  const discord = new DiscordWebhookSender(fetchFn);
  const expoPush =
    push === null
      ? null
      : new ExpoPushSender(
          new ExpoPushClient(push.fetchFn ?? fetchFn, push.accessToken),
          push.devices,
          push.appUrl,
          push.clock,
        );

  return {
    async send(channel, message: NotificationMessage) {
      switch (channel.type) {
        case "EMAIL":
          return email.send(
            emailChannelConfigSchema.parse(channel.config),
            message,
          );
        case "SMS": {
          const parsed = smsChannelConfigSchema.parse(channel.config);
          return {
            providerMessageId: await twilio.sendSms(
              parsed.phoneNumber,
              config.twilio.fromSms,
              smsBody(message.shortText),
            ),
          };
        }
        case "WHATSAPP": {
          if (config.twilio.fromWhatsapp === null) {
            throw new Error("WhatsApp is not configured");
          }
          const parsed = phoneChannelConfigSchema.parse(channel.config);
          return {
            providerMessageId: await twilio.sendWhatsapp(
              parsed.phoneNumber,
              config.twilio.fromWhatsapp,
              message.shortText,
            ),
          };
        }
        case "CALL": {
          const parsed = phoneChannelConfigSchema.parse(channel.config);
          return {
            providerMessageId: await twilio.startCall(
              parsed.phoneNumber,
              config.twilio.fromCall,
              speechTwiml(message.speakText),
            ),
          };
        }
        case "SLACK": {
          const parsed = slackChannelConfigSchema.parse(channel.config);
          await slack.send(parsed.webhookUrl, message);
          return { providerMessageId: null };
        }
        case "DISCORD": {
          const parsed = discordChannelConfigSchema.parse(channel.config);
          await discord.send(parsed.webhookUrl, message);
          return { providerMessageId: null };
        }
        case "PUSH": {
          pushChannelConfigSchema.parse(channel.config);
          if (expoPush === null) throw new Error("Push is not configured");
          if (channel.workspaceId === undefined) {
            throw new Error("Push delivery needs a workspace");
          }
          return expoPush.send(channel.workspaceId, message);
        }
      }
    },
  };
}
