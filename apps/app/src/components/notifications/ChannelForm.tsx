import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createChannel, updateChannel } from "@/api/channels";
import type { Channel, ChannelType } from "@/api/types";
import { FormError } from "@/components/FormError";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { colors, gutter, palette, radius, spacing } from "@/theme";
import { Badge, Button, Caption, Card, Field, Heading, Input, Label, Muted, Toggle } from "@/ui";

import {
  channelFormDefaults,
  channelFormErrors,
  channelFormSchema,
  channelTypeOptions,
  createChannelInput,
  isPaidChannelType,
  isPhoneChannelType,
  isWebhookChannelType,
  phoneHint,
  smsConsentCopy,
  updateChannelInput,
  webhookHint,
  type ChannelFormField,
  type ChannelFormValues,
  isEditableChannelType,
} from "./channel-form";
import { channelTypeLabels } from "./channels";
import { ChannelTile } from "./ChannelTile";
import { EmailListInput } from "./EmailListInput";

export interface ChannelFormProps {
  /** Editing an existing channel; omitted to create one. */
  channel?: Channel;
  onClose: () => void;
  open: boolean;
}

function TypePicker({ onSelect }: { onSelect: (type: ChannelType) => void }) {
  return (
    <View>
      <Muted style={styles.pickerIntro}>Choose how Zenguy should notify your team.</Muted>
      <View style={styles.typeGrid}>
        {channelTypeOptions.map(({ label, paid, type }) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            style={({ pressed }) => [styles.typeButton, pressed && styles.typeButtonPressed]}
            onPress={() => onSelect(type)}
          >
            <ChannelTile size={36} type={type} />
            <Label style={styles.typeLabel}>{label}</Label>
            <Caption color={paid ? colors.warn : colors.okDark}>{paid ? "Pay as you go" : "Free"}</Caption>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Page-sheet port of the web ChannelFormModal: pick a type, then fill in its config. */
export function ChannelForm({ channel, onClose, open }: ChannelFormProps) {
  const editing = Boolean(channel);
  const router = useRouter();
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
  const resetSave = save.reset;

  // The sheet keeps its content mounted between openings; reset on show.
  const handleShow = () => {
    form.reset(channelFormDefaults(channel));
    setSelectedType(channel?.type ?? null);
    resetSave();
  };

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
      const { fields, root } = channelFormErrors(error);
      for (const [field, message] of Object.entries(fields)) {
        if (message) form.setError(field as ChannelFormField, { message });
      }
      if (root) {
        form.setError("root", { message: root });
        toast.error(root);
      }
    }
  });

  const selectType = (type: ChannelType) => {
    if (!isEditableChannelType(type)) return;
    form.setValue("type", type, { shouldValidate: false });
    form.clearErrors();
    setSelectedType(type);
  };

  const rootError = form.formState.errors.root?.message;
  const title = editing ? `Edit ${channel?.name ?? "channel"}` : "Add notification channel";

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={open}
      onRequestClose={onClose}
      onShow={handleShow}
    >
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.header}>
          <Button disabled={save.isPending} title="Cancel" variant="ghost" onPress={close} />
          <Heading numberOfLines={1} style={styles.title}>
            {title}
          </Heading>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {!selectedType ? (
            <TypePicker onSelect={selectType} />
          ) : (
            <View style={styles.form}>
              <Card eyebrow="Channel">
                <View style={styles.fields}>
                  <View style={styles.typeRow}>
                    <ChannelTile size={32} tone="accent" type={selectedType} />
                    <Badge tone="accent">{channelTypeLabels[selectedType]}</Badge>
                  </View>

                  <Controller
                    control={form.control}
                    name="name"
                    render={({ field, fieldState }) => (
                      <Field error={fieldState.error?.message} label="Name" required>
                        <Input
                          invalid={Boolean(fieldState.error)}
                          maxLength={80}
                          placeholder="Engineering alerts"
                          value={field.value}
                          onBlur={field.onBlur}
                          onChangeText={field.onChange}
                        />
                      </Field>
                    )}
                  />
                </View>
              </Card>

              <Card eyebrow="Destination">
                <View style={styles.fields}>
                  {selectedType === "EMAIL" ? (
                    <Controller
                      control={form.control}
                      name="emails"
                      render={({ field, fieldState }) => (
                        <Field
                          error={fieldState.error?.message}
                          hint="Press Enter or comma after each address. Up to 10 recipients."
                          label="Email addresses"
                          required
                        >
                          <EmailListInput
                            invalid={Boolean(fieldState.error)}
                            value={field.value}
                            onChange={(emails) => {
                              field.onChange(emails);
                              void form.trigger("emails");
                            }}
                          />
                        </Field>
                      )}
                    />
                  ) : null}

                  {isPhoneChannelType(selectedType) ? (
                    <Controller
                      control={form.control}
                      name="phoneNumber"
                      render={({ field, fieldState }) => (
                        <Field
                          error={fieldState.error?.message}
                          hint={phoneHint(selectedType)}
                          label="Phone number"
                          required
                        >
                          <Input
                            autoComplete="tel"
                            invalid={Boolean(fieldState.error)}
                            keyboardType="phone-pad"
                            mono
                            placeholder="+34612345678"
                            textContentType="telephoneNumber"
                            value={field.value}
                            onBlur={field.onBlur}
                            onChangeText={field.onChange}
                          />
                        </Field>
                      )}
                    />
                  ) : null}

                  {isPaidChannelType(selectedType) ? (
                    <Controller
                      control={form.control}
                      name="smsConsent"
                      render={({ field, fieldState }) => (
                        <View style={styles.consent}>
                          <Toggle
                            description={smsConsentCopy}
                            label="Recipient consent"
                            value={field.value}
                            onValueChange={field.onChange}
                          />
                          <View style={styles.legalLinks}>
                            <Pressable
                              accessibilityRole="link"
                              onPress={() => router.push("/terms" as Href)}
                            >
                              <Label color={colors.accentDark}>Terms</Label>
                            </Pressable>
                            <Pressable
                              accessibilityRole="link"
                              onPress={() => router.push("/privacy" as Href)}
                            >
                              <Label color={colors.accentDark}>Privacy Policy</Label>
                            </Pressable>
                          </View>
                          {fieldState.error ? (
                            <Caption accessibilityRole="alert" color={colors.dangerDark}>
                              {fieldState.error.message}
                            </Caption>
                          ) : null}
                        </View>
                      )}
                    />
                  ) : null}

                  {isWebhookChannelType(selectedType) ? (
                    <Controller
                      control={form.control}
                      name="webhookUrl"
                      render={({ field, fieldState }) => (
                        <Field
                          error={fieldState.error?.message}
                          hint={webhookHint(selectedType)}
                          label="Webhook URL"
                          required={!editing}
                        >
                          <View style={styles.webhook}>
                            {editing ? (
                              <Caption>
                                Currently: {channel?.configPreview.webhookUrlMasked ?? "masked"}
                              </Caption>
                            ) : null}
                            <Input
                              autoCapitalize="none"
                              autoComplete="off"
                              autoCorrect={false}
                              invalid={Boolean(fieldState.error)}
                              keyboardType="url"
                              mono
                              placeholder={editing ? "Paste a new URL to replace it" : "https://"}
                              textContentType="URL"
                              value={field.value}
                              onBlur={field.onBlur}
                              onChangeText={field.onChange}
                            />
                          </View>
                        </Field>
                      )}
                    />
                  ) : null}
                </View>
              </Card>

              <FormError message={rootError} />

              <View style={styles.footer}>
                {!editing ? (
                  <Button
                    disabled={save.isPending}
                    title="Back"
                    onPress={() => setSelectedType(null)}
                  />
                ) : null}
                <Button
                  loading={save.isPending}
                  style={styles.submit}
                  title={editing ? "Save changes" : "Create channel"}
                  variant="accent"
                  onPress={() => void submit()}
                />
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  consent: { gap: spacing.sm },
  content: { paddingBottom: spacing.xxxl, paddingHorizontal: gutter, paddingTop: spacing.md },
  fields: { gap: spacing.lg },
  footer: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  form: { gap: spacing.xl },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
  },
  headerSpacer: { width: 80 },
  legalLinks: { flexDirection: "row", gap: spacing.lg },
  pickerIntro: { marginBottom: spacing.lg },
  sheet: { backgroundColor: colors.bg, flex: 1 },
  submit: { flex: 1 },
  title: { flex: 1, textAlign: "center" },
  typeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 108,
    padding: spacing.md,
  },
  typeButtonPressed: { backgroundColor: palette.violetBg, borderColor: palette.violetLine },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  typeLabel: { marginTop: spacing.xs },
  typeRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  webhook: { gap: spacing.xs },
});
