import { z } from "zod";

export type ChannelType =
  | "EMAIL"
  | "SMS"
  | "WHATSAPP"
  | "CALL"
  | "SLACK"
  | "DISCORD";

export type DeliveryEventType = "FAILURE" | "RECOVERY" | "TEST";
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

export interface NotificationChannel {
  id: string;
  workspaceId: string;
  name: string;
  type: ChannelType;
  encryptedConfig: string;
  enabled: boolean;
  /** Preselected for new tests and monitors. */
  isDefault?: boolean;
  verifiedAt: number | null;
  lastDeliveryStatus: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationDelivery {
  id: string;
  workspaceId: string;
  incidentId: string | null;
  notificationChannelId: string;
  eventType: DeliveryEventType;
  status: DeliveryStatus;
  providerMessageId: string | null;
  attemptCount: number;
  errorSanitized: string | null;
  sentAt: number | null;
  createdAt: number;
  /** Euro cents charged to the workspace's alert credit, for paid channels. */
  costCents?: number | null;
  /** Destination country name used for pricing, for paid channels. */
  destinationCountry?: string | null;
}

export interface IncidentNotificationDelivery extends NotificationDelivery {
  channelName: string;
  channelType: ChannelType | null;
}

export const emailChannelConfigSchema = z
  .object({ emails: z.array(z.email()).min(1).max(10) })
  .strict();

export const phoneChannelConfigSchema = z
  .object({ phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/u) })
  .strict();

export const smsChannelConfigSchema = z
  .object({
    phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/u),
    consent: z.literal(true),
  })
  .strict();

export const slackChannelConfigSchema = z
  .object({
    webhookUrl: z
      .url()
      .refine((value) => value.startsWith("https://hooks.slack.com/")),
  })
  .strict();

export const discordChannelConfigSchema = z
  .object({
    webhookUrl: z.url().refine(
      (value) =>
        value.startsWith("https://discord.com/api/webhooks/") ||
        value.startsWith("https://discordapp.com/api/webhooks/"),
    ),
  })
  .strict();

export type EmailChannelConfig = z.infer<typeof emailChannelConfigSchema>;
export type PhoneChannelConfig = z.infer<typeof phoneChannelConfigSchema>;
export type SmsChannelConfig = z.infer<typeof smsChannelConfigSchema>;
export type WebhookChannelConfig = z.infer<typeof slackChannelConfigSchema>;
export type ChannelConfig =
  | EmailChannelConfig
  | PhoneChannelConfig
  | SmsChannelConfig
  | WebhookChannelConfig;

export function channelConfigSchema(type: ChannelType): z.ZodType<ChannelConfig> {
  switch (type) {
    case "EMAIL":
      return emailChannelConfigSchema;
    case "SMS":
      return smsChannelConfigSchema;
    case "WHATSAPP":
    case "CALL":
      return phoneChannelConfigSchema;
    case "SLACK":
      return slackChannelConfigSchema;
    case "DISCORD":
      return discordChannelConfigSchema;
  }
}

export type ChannelConfigPreview =
  | { emails: string[] }
  | { phoneNumber: string }
  | { webhookUrlMasked: string };

export function configPreview(
  type: ChannelType,
  config: unknown,
): ChannelConfigPreview {
  switch (type) {
    case "EMAIL": {
      const parsed = emailChannelConfigSchema.parse(config);
      return { emails: [...parsed.emails] };
    }
    case "SMS": {
      const parsed = smsChannelConfigSchema.parse(config);
      return { phoneNumber: parsed.phoneNumber };
    }
    case "WHATSAPP":
    case "CALL": {
      const parsed = phoneChannelConfigSchema.parse(config);
      return { phoneNumber: parsed.phoneNumber };
    }
    case "SLACK": {
      const parsed = slackChannelConfigSchema.parse(config);
      return {
        webhookUrlMasked: `https://hooks.slack.com/…${parsed.webhookUrl.slice(-4)}`,
      };
    }
    case "DISCORD": {
      const parsed = discordChannelConfigSchema.parse(config);
      const prefix = parsed.webhookUrl.startsWith("https://discordapp.com/")
        ? "https://discordapp.com/api/webhooks/"
        : "https://discord.com/api/webhooks/";
      return {
        webhookUrlMasked: `${prefix}…${parsed.webhookUrl.slice(-4)}`,
      };
    }
  }
}
