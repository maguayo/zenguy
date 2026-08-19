import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gamepad2,
  Hash,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  createChannel,
  updateChannel,
  type CreateChannelInput,
  type UpdateChannelInput,
} from "../../api/channels";
import type { Channel, ChannelConfigInput, ChannelType } from "../../api/types";
import { EmailListInput } from "../../components/EmailListInput";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { apiErrorMessage } from "../../lib/errors";

const channelTypes: Array<{ icon: LucideIcon; label: string; type: ChannelType }> = [
  { icon: Mail, label: "Email", type: "EMAIL" },
  { icon: MessageSquare, label: "SMS", type: "SMS" },
  { icon: MessageCircle, label: "WhatsApp", type: "WHATSAPP" },
  { icon: Phone, label: "Phone call", type: "CALL" },
  { icon: Hash, label: "Slack", type: "SLACK" },
  { icon: Gamepad2, label: "Discord", type: "DISCORD" },
];

const baseSchema = z.object({
  emails: z.array(z.email("Enter a valid email address.")).max(10),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(80, "Name must be 80 characters or fewer."),
  phoneNumber: z.string(),
  type: z.enum(["EMAIL", "SMS", "WHATSAPP", "CALL", "SLACK", "DISCORD"]),
  webhookUrl: z.string(),
});

export type ChannelFormValues = z.infer<typeof baseSchema>;

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
  type: "EMAIL",
  webhookUrl: "",
};

export function channelFormDefaults(channel?: Channel): ChannelFormValues {
  if (!channel) return { ...blankValues, emails: [] };
  return {
    emails: channel.configPreview.emails ?? [],
    name: channel.name,
    phoneNumber: channel.configPreview.phoneNumber ?? "",
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
    case "CALL":
      return { phoneNumber: values.phoneNumber.trim() };
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

function TypePicker({ onSelect }: { onSelect: (type: ChannelType) => void }) {
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-600">Choose how Zenguy should notify your team.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {channelTypes.map(({ icon: Icon, label, type }) => (
          <button
            key={type}
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm font-medium text-zinc-800 hover:border-accent-600 hover:bg-accent-50 hover:text-accent-700"
            type="button"
            onClick={() => onSelect(type)}
          >
            <Icon aria-hidden="true" className="size-5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ChannelFormModalProps {
  channel?: Channel;
  onClose: () => void;
  open: boolean;
}

export function ChannelFormModal({ channel, onClose, open }: ChannelFormModalProps) {
  const editing = Boolean(channel);
  const { current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [selectedType, setSelectedType] = useState<ChannelType | null>(channel?.type ?? null);
  const form = useForm<ChannelFormValues>({
    defaultValues: channelFormDefaults(channel),
    mode: "onChange",
    resolver: zodResolver(channelFormSchema(editing)),
  });
  const save = useMutation({
    mutationFn: (values: ChannelFormValues) =>
      channel
        ? updateChannel(current.id, channel.id, updateChannelInput(values))
        : createChannel(current.id, createChannelInput(values)),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(channelFormDefaults(channel));
    setSelectedType(channel?.type ?? null);
    save.reset();
  }, [channel, form, open]);

  const close = () => {
    if (!save.isPending) onClose();
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "channels"] });
      toast.success(channel ? "Changes saved" : "Channel created");
      onClose();
    } catch (error) {
      if (handleMutationError(error)) return;
      const message = apiErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    }
  });

  const selectType = (type: ChannelType) => {
    form.setValue("type", type, { shouldValidate: false });
    form.clearErrors();
    setSelectedType(type);
  };

  const phoneHint =
    selectedType === "WHATSAPP" ? (
      <>
        E.164 format, with country code. The number must have WhatsApp and accept messages from
        your Twilio sender.
      </>
    ) : (
      "E.164 format, with country code."
    );
  const rootError = form.formState.errors.root?.message;

  return (
    <Modal
      footer={
        selectedType ? (
          <>
            {!editing ? (
              <Button disabled={save.isPending} onClick={() => setSelectedType(null)}>
                Back
              </Button>
            ) : null}
            <Button disabled={save.isPending} onClick={close}>
              Cancel
            </Button>
            <Button loading={save.isPending} type="submit" variant="primary" form="channel-form">
              {editing ? "Save changes" : "Create channel"}
            </Button>
          </>
        ) : (
          <Button onClick={close}>Cancel</Button>
        )
      }
      onClose={close}
      open={open}
      title={editing ? `Edit ${channel?.name ?? "channel"}` : "Add notification channel"}
    >
      {!selectedType ? (
        <TypePicker onSelect={selectType} />
      ) : (
        <form className="space-y-4" id="channel-form" noValidate onSubmit={(event) => void submit(event)}>
          <Field
            error={fieldError(form.formState, "name")}
            htmlFor="channel-name"
            label="Name"
            required
          >
            <Input
              id="channel-name"
              invalid={Boolean(fieldError(form.formState, "name"))}
              maxLength={80}
              placeholder="Engineering alerts"
              {...form.register("name")}
            />
          </Field>

          {selectedType === "EMAIL" ? (
            <Field
              error={fieldError(form.formState, "emails")}
              hint="Press Enter or comma after each address. Up to 10 recipients."
              htmlFor="channel-emails"
              label="Email addresses"
              required
            >
              <Controller
                control={form.control}
                name="emails"
                render={({ field }) => (
                  <EmailListInput
                    id="channel-emails"
                    invalid={Boolean(fieldError(form.formState, "emails"))}
                    value={field.value}
                    onChange={(emails) => {
                      field.onChange(emails);
                      void form.trigger("emails");
                    }}
                  />
                )}
              />
            </Field>
          ) : null}

          {selectedType === "SMS" || selectedType === "WHATSAPP" || selectedType === "CALL" ? (
            <Field
              error={fieldError(form.formState, "phoneNumber")}
              hint={phoneHint}
              htmlFor="channel-phone"
              label="Phone number"
              required
            >
              <Input
                id="channel-phone"
                invalid={Boolean(fieldError(form.formState, "phoneNumber"))}
                placeholder="+34612345678"
                type="tel"
                {...form.register("phoneNumber")}
              />
            </Field>
          ) : null}

          {selectedType === "SLACK" || selectedType === "DISCORD" ? (
            <Field
              error={fieldError(form.formState, "webhookUrl")}
              hint={
                selectedType === "SLACK"
                  ? "Create an incoming webhook in your Slack workspace and paste the URL. Treat it like a password."
                  : "Create a webhook in your Discord server and paste the URL. Treat it like a password."
              }
              htmlFor="channel-webhook"
              label="Webhook URL"
              required={!editing}
            >
              <div className="space-y-1.5">
                {editing ? (
                  <p className="text-xs text-zinc-500">
                    Currently: {channel?.configPreview.webhookUrlMasked ?? "masked"}
                  </p>
                ) : null}
                <Input
                  autoComplete="off"
                  id="channel-webhook"
                  invalid={Boolean(fieldError(form.formState, "webhookUrl"))}
                  placeholder={editing ? "Paste a new URL to replace it" : "https://"}
                  type="url"
                  {...form.register("webhookUrl")}
                />
              </div>
            </Field>
          ) : null}

          {rootError ? (
            <p className="rounded-md bg-danger-50 p-3 text-sm text-danger-700" role="alert">
              {rootError}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

export default ChannelFormModal;
