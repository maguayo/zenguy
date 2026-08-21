import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Modal, StyleSheet, View } from "react-native";

import { invite } from "@/api/members";
import { FormError } from "@/components/FormError";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { apiErrorMessage } from "@/lib/errors";
import { spacing } from "@/theme";
import { Button, Field, Input, Screen, SelectSheet, Title } from "@/ui";

import {
  invitationSentMessage,
  inviteDefaults,
  inviteErrorPresentation,
  inviteInput,
  inviteRoleOptions,
  inviteSchema,
  type InviteValues,
} from "./invite-form";

interface Props {
  onClose: () => void;
  open: boolean;
}

/** Invite sheet mirroring the web's InviteMemberModal. */
export function InviteForm({ onClose, open }: Props) {
  const { can, current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const form = useForm<InviteValues>({
    defaultValues: inviteDefaults(),
    mode: "onChange",
    resolver: zodResolver(inviteSchema),
  });
  const send = useMutation({
    mutationFn: (values: InviteValues) => invite(current.id, inviteInput(values)),
  });
  const { reset: resetForm } = form;
  const { reset: resetSend } = send;

  useEffect(() => {
    if (!open) return;
    resetForm(inviteDefaults());
    resetSend();
  }, [open, resetForm, resetSend]);

  const close = () => {
    if (send.isPending) return;
    resetForm(inviteDefaults());
    onClose();
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    const { email } = inviteInput(values);
    try {
      await send.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "invitations"] });
      toast.success(invitationSentMessage(email));
      resetForm(inviteDefaults());
      onClose();
    } catch (error) {
      const known = inviteErrorPresentation(error);
      if (known) {
        form.setError(known.field, { message: known.message });
        return;
      }
      if (handleMutationError(error)) return;
      const message = apiErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    }
  });

  const roleOptions = inviteRoleOptions(can("admins.manage"));

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={open}
      onRequestClose={onClose}
    >
      <Screen keyboard safe={["bottom"]}>
        <View style={styles.header}>
          <Button disabled={send.isPending} size="sm" title="Cancel" variant="ghost" onPress={close} />
        </View>
        <Title style={styles.title}>Invite member</Title>

        <View style={styles.form}>
          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Email" required>
                <Input
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  autoFocus
                  inputMode="email"
                  invalid={Boolean(fieldState.error)}
                  keyboardType="email-address"
                  placeholder="teammate@example.com"
                  returnKeyType="done"
                  textContentType="emailAddress"
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  onSubmitEditing={() => void submit()}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="role"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Role" required>
                <SelectSheet
                  accessibilityLabel="Role"
                  invalid={Boolean(fieldState.error)}
                  options={roleOptions}
                  title="Role"
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <FormError message={form.formState.errors.root?.message} />
          <Button
            fullWidth
            loading={send.isPending}
            size="lg"
            title="Send invitation"
            variant="primary"
            onPress={() => void submit()}
          />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  header: { alignItems: "flex-start", marginLeft: -spacing.md, marginTop: -spacing.sm },
  title: { marginBottom: spacing.xl, marginTop: spacing.sm },
});
