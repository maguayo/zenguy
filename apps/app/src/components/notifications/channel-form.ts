import { z } from "zod";

import type { CreateChannelInput, UpdateChannelInput } from "@/api/channels";
import type { Channel, ChannelConfigInput, ChannelType } from "@/api/types";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

/** Channel types a user can create or edit; PUSH channels are managed by the API. */
export type EditableChannelType = Exclude<ChannelType, "PUSH">;

export function isEditableChannelType(type: ChannelType | null | undefined): type is EditableChannelType {
  return type !== null && type !== undefined && type !== "PUSH";
}

export interface ChannelTypeOption {
  label: string;
  type: ChannelType;
}

export const channelTypeOptions: ChannelTypeOption[] = [
  { label: "Email", type: "EMAIL" },
  { label: "SMS", type: "SMS" },
  { label: "WhatsApp", type: "WHATSAPP" },
  { label: "Phone call", type: "CALL" },
  { label: "Slack", type: "SLACK" },
  { label: "Discord", type: "DISCORD" },
];

export function isPhoneChannelType(type: ChannelType | null): boolean {
  return type === "SMS" || type === "CALL" || type === "WHATSAPP";
}

export function isWebhookChannelType(type: ChannelType | null): boolean {
  return type === "SLACK" || type === "DISCORD";
}

export const smsConsentCopy =
  "I confirm that this recipient explicitly agreed to receive recurring operational alerts through this channel from Zenguy. Frequency varies. Carrier charges may apply. For SMS, reply STOP to opt out or HELP for help.";

export function phoneHint(type: ChannelType | null): string {
  return type === "WHATSAPP"
    ? "E.164 format, with country code. The number must have WhatsApp and accept messages from your Twilio sender."
    : "E.164 format, with country code.";
}

export function webhookHint(type: ChannelType | null): string {
  return type === "SLACK"
    ? "Create an incoming webhook in your Slack workspace and paste the URL. Treat it like a password."
    : "Create a webhook in your Discord server and paste the URL. Treat it like a password.";
}

const baseSchema = z.object({
  emails: z.array(z.email("Enter a valid email address.")).max(10),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(80, "Name must be 80 characters or fewer."),
  phoneNumber: z.string(),
  smsConsent: z.boolean(),
  type: z.enum(["EMAIL", "SMS", "WHATSAPP", "CALL", "SLACK", "DISCORD"]),
  webhookUrl: z.string(),
});

export type ChannelFormValues = z.infer<typeof baseSchema>;
export type ChannelFormField = Exclude<keyof ChannelFormValues, "type">;

export function channelFormSchema(editing = false) {
  return baseSchema.superRefine((values, context) => {
    if (values.type === "EMAIL" && values.emails.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Add at least one email address.",
        path: ["emails"],
      });
    }

    if (
      (values.type === "SMS" || values.type === "WHATSAPP" || values.type === "CALL") &&
      !/^\+[1-9]\d{6,14}$/u.test(values.phoneNumber.trim())
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter a phone number in E.164 format.",
        path: ["phoneNumber"],
      });
    }

    if (isPhoneChannelType(values.type) && !values.smsConsent) {
      context.addIssue({
        code: "custom",
        message: "Confirm the recipient's explicit consent.",
        path: ["smsConsent"],
      });
    }

    if (values.type === "SLACK" || values.type === "DISCORD") {
      const url = values.webhookUrl.trim();
      if (editing && !url) return;
      const prefix =
        values.type === "SLACK"
          ? "https://hooks.slack.com/"
          : "https://discord.com/api/webhooks/";
      if (!z.url().safeParse(url).success || !url.startsWith(prefix)) {
        context.addIssue({
          code: "custom",
          message: `Webhook URL must start with ${prefix}`,
          path: ["webhookUrl"],
        });
      }
    }
  });
}

const blankValues: ChannelFormValues = {
  emails: [],
  name: "",
  phoneNumber: "",
  smsConsent: false,
  type: "EMAIL",
  webhookUrl: "",
};

export function channelFormDefaults(channel?: Channel): ChannelFormValues {
  if (!channel || !isEditableChannelType(channel.type)) return { ...blankValues, emails: [] };
  return {
    emails: channel.configPreview.emails ?? [],
    name: channel.name,
    phoneNumber: channel.configPreview.phoneNumber ?? "",
    // Consent is deliberately write-only and must be reconfirmed on edits.
    smsConsent: false,
    type: channel.type,
    webhookUrl: "",
  };
}

export function channelConfigFromValues(values: ChannelFormValues): ChannelConfigInput {
  switch (values.type) {
    case "EMAIL":
      return { emails: values.emails };
    case "SMS":
    case "WHATSAPP":
    case "CALL": {
      if (!values.smsConsent) throw new Error("Recipient consent is required");
      return { consent: true, phoneNumber: values.phoneNumber.trim() };
    }
    case "SLACK":
    case "DISCORD":
      return { webhookUrl: values.webhookUrl.trim() };
  }
}

export function createChannelInput(values: ChannelFormValues): CreateChannelInput {
  return {
    config: channelConfigFromValues(values),
    name: values.name.trim(),
    type: values.type,
  };
}

export function updateChannelInput(values: ChannelFormValues): UpdateChannelInput {
  const input: UpdateChannelInput = { name: values.name.trim() };
  const writeOnlyWebhook = values.type === "SLACK" || values.type === "DISCORD";
  if (!writeOnlyWebhook || values.webhookUrl.trim()) {
    input.config = channelConfigFromValues(values);
  }
  return input;
}

const fieldAliases: Record<string, ChannelFormField> = {
  consent: "smsConsent",
  emails: "emails",
  name: "name",
  phoneNumber: "phoneNumber",
  smsConsent: "smsConsent",
  webhookUrl: "webhookUrl",
};

/** Maps an API validation path (`config.emails.0`, `name`, …) onto a form field. */
export function channelFormField(path: string): ChannelFormField | null {
  const head = path.split(".").find((segment) => segment && segment !== "config");
  return head ? (fieldAliases[head] ?? null) : null;
}

export interface ChannelFormErrors {
  fields: Partial<Record<ChannelFormField, string>>;
  /** Shown as the form-level error for anything that isn't a field. */
  root: string | null;
}

export function channelFormErrors(error: unknown): ChannelFormErrors {
  const fields: Partial<Record<ChannelFormField, string>> = {};
  if (
    !(error instanceof ApiError) ||
    error.code !== "VALIDATION_ERROR" ||
    !error.details ||
    error.details.length === 0
  ) {
    return { fields, root: apiErrorMessage(error) };
  }

  let root: string | null = null;
  for (const detail of error.details) {
    const field = channelFormField(detail.field);
    if (field) fields[field] ??= detail.message;
    else root ??= detail.message;
  }
  if (root === null && Object.keys(fields).length === 0) root = apiErrorMessage(error);
  return { fields, root };
}
