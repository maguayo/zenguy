import { useEffect, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Modal, StyleSheet, View, type TextInput } from "react-native";

import { createSecret, replaceSecret } from "@/api/secrets";
import type { Secret } from "@/api/types";
import { FormError } from "@/components/FormError";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { colors, radius, spacing, typography } from "@/theme";
import { Button, Field, Input, Muted, PasswordInput, Screen, Title } from "@/ui";

import { DomainListInput, type DomainListInputHandle } from "./DomainListInput";
import {
  createSecretInput,
  replaceMetaInput,
  replaceValueInput,
  secretDomainsHint,
  secretFieldErrors,
  secretFormDefaults,
  secretFormFields,
  secretFormSchema,
  secretFormSubmitLabel,
  secretFormTitle,
  secretKeyConflictMessage,
  secretKeyHint,
  secretReplaceNote,
  secretSavedMessage,
  secretValueHint,
  type SecretFormMode,
  type SecretFormValues,
} from "./secret-form";

interface Props {
  mode: SecretFormMode;
  onClose: () => void;
  open: boolean;
  secret?: Secret;
}

/**
 * Create / replace-value / edit-metadata sheet, mirroring the web's
 * SecretFormModal. The value is write-only: never prefilled, never displayed.
 */
export function SecretForm({ mode, onClose, open, secret }: Props) {
  const { current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const valueRef = useRef<TextInput>(null);
  const domainsRef = useRef<DomainListInputHandle>(null);
  const fields = secretFormFields(mode);
  const form = useForm<SecretFormValues>({
    defaultValues: secretFormDefaults(secret),
    mode: "onChange",
    resolver: zodResolver(secretFormSchema(mode)),
  });
  const save = useMutation({
    mutationFn: (values: SecretFormValues) => {
      if (mode === "create") return createSecret(current.id, createSecretInput(values));
      if (!secret) throw new Error("Secret not found");
      return replaceSecret(
        current.id,
        secret.id,
        mode === "replace" ? replaceValueInput(values) : replaceMetaInput(values),
      );
    },
  });
  const { reset: resetForm } = form;
  const { reset: resetSave } = save;

  useEffect(() => {
    if (!open) return;
    resetForm(secretFormDefaults(secret));
    resetSave();
  }, [mode, open, resetForm, resetSave, secret]);

  const close = () => {
    if (save.isPending) return;
    resetForm(secretFormDefaults(secret));
    onClose();
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "secrets"] });
      toast.success(secretSavedMessage(mode));
      resetForm(secretFormDefaults(secret));
      onClose();
    } catch (error) {
      if (mode === "create" && error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("key", { message: secretKeyConflictMessage });
        return;
      }
      if (error instanceof ApiError) {
        const fieldErrors = secretFieldErrors(error.details, fields);
        if (fieldErrors.length > 0) {
          for (const { field, message } of fieldErrors) form.setError(field, { message });
          return;
        }
      }
      if (handleMutationError(error)) return;
      const message = apiErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    }
  });

  const onSubmitPress = () => {
    // A domain still being typed counts: commit it before validating.
    if (domainsRef.current && !domainsRef.current.flush()) return;
    void submit();
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={open}
      onRequestClose={onClose}
    >
      <Screen keyboard safe={["bottom"]}>
        <View style={styles.header}>
          <Button disabled={save.isPending} size="sm" title="Cancel" variant="ghost" onPress={close} />
        </View>
        <Title style={styles.title}>{secretFormTitle(mode, secret)}</Title>

        <View style={styles.form}>
          {mode === "create" ? (
            <Controller
              control={form.control}
              name="key"
              render={({ field, fieldState }) => (
                <Field error={fieldState.error?.message} hint={secretKeyHint} label="Key" required>
                  <Input
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect={false}
                    invalid={Boolean(fieldState.error)}
                    maxLength={64}
                    placeholder="SHOP_PASSWORD"
                    returnKeyType="next"
                    spellCheck={false}
                    style={styles.mono}
                    textContentType="none"
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={(text) => field.onChange(text.toUpperCase())}
                    onSubmitEditing={() => valueRef.current?.focus()}
                  />
                </Field>
              )}
            />
          ) : (
            <Field label="Key">
              <Input
                accessibilityLabel="Key"
                editable={false}
                style={[styles.mono, styles.readonly]}
                value={secret?.key ?? ""}
              />
            </Field>
          )}

          {mode === "replace" ? (
            <View style={styles.note}>
              <Muted>{secretReplaceNote}</Muted>
            </View>
          ) : null}

          {fields.includes("value") ? (
            <Controller
              control={form.control}
              name="value"
              render={({ field, fieldState }) => (
                <Field
                  error={fieldState.error?.message}
                  hint={secretValueHint}
                  label={mode === "create" ? "Value" : "New value"}
                  required
                >
                  <PasswordInput
                    ref={valueRef}
                    autoComplete="off"
                    invalid={Boolean(fieldState.error)}
                    maxLength={4_096}
                    returnKeyType="done"
                    textContentType="none"
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={field.onChange}
                  />
                </Field>
              )}
            />
          ) : null}

          {fields.includes("allowedDomains") ? (
            <Controller
              control={form.control}
              name="allowedDomains"
              render={({ field, fieldState }) => (
                <Field
                  error={fieldState.error?.message}
                  hint={secretDomainsHint}
                  label="Allowed domains"
                  required
                >
                  <DomainListInput
                    ref={domainsRef}
                    invalid={Boolean(fieldState.error)}
                    value={field.value}
                    onChange={(domains) => {
                      field.onChange(domains);
                      void form.trigger("allowedDomains");
                    }}
                  />
                </Field>
              )}
            />
          ) : null}

          {fields.includes("description") ? (
            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <Field error={fieldState.error?.message} label="Description">
                  <Input
                    invalid={Boolean(fieldState.error)}
                    placeholder="Optional note for your team"
                    returnKeyType="done"
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={field.onChange}
                  />
                </Field>
              )}
            />
          ) : null}

          <FormError message={form.formState.errors.root?.message} />
          <Button
            fullWidth
            loading={save.isPending}
            size="lg"
            title={secretFormSubmitLabel(mode)}
            variant="primary"
            onPress={onSubmitPress}
          />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  header: { alignItems: "flex-start", marginLeft: -spacing.md, marginTop: -spacing.sm },
  mono: { fontFamily: typography.mono.fontFamily },
  note: { backgroundColor: colors.zinc100, borderRadius: radius.md, padding: spacing.md },
  readonly: { backgroundColor: colors.zinc50, color: colors.zinc600 },
  title: { marginBottom: spacing.xl, marginTop: spacing.sm },
});
