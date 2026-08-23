import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View, type TextInput } from "react-native";

import { resetPassword } from "@/api/auth";
import {
  isResetLinkExpired,
  resetPasswordFormSchema,
  resetTokenMessage,
  type ResetPasswordFormValues,
} from "@/components/auth/password-flows";
import { AuthStatus } from "@/components/auth/AuthStatus";
import { AuthShell } from "@/components/AuthShell";
import { useToast } from "@/contexts/ToastContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { parseLinkToken } from "@/lib/links";
import { spacing } from "@/theme";
import { Button, Field, Input, PasswordInput } from "@/ui";

type ResetState = "form" | "gone" | "success";

export default function ResetPassword() {
  const params = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const toast = useToast();
  // The token only ever reaches the API through parseLinkToken: from the deep
  // link when there is one, otherwise pasted by the user from the email link.
  const linkToken = parseLinkToken(params.token);
  const [state, setState] = useState<ResetState>("form");
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const form = useForm<ResetPasswordFormValues>({
    defaultValues: { confirmPassword: "", password: "", token: linkToken ?? "" },
    resolver: zodResolver(resetPasswordFormSchema),
  });

  const submit = form.handleSubmit(async ({ password, token }) => {
    const safeToken = parseLinkToken(token);
    if (!safeToken) {
      form.setError("token", { message: resetTokenMessage });
      return;
    }
    try {
      await resetPassword(safeToken, password);
      setState("success");
    } catch (error) {
      const passwordIssue =
        error instanceof ApiError
          ? error.details?.find((detail) => detail.field === "password")
          : undefined;
      if (passwordIssue) form.setError("password", { message: passwordIssue.message });
      else if (isResetLinkExpired(error)) setState("gone");
      else toast.error(apiErrorMessage(error));
    }
  });

  if (state === "success") {
    return (
      <AuthStatus
        description="Password updated. Sign in with your new password."
        icon="check"
        title="Password updated"
        tone="ok"
      >
        <Button
          fullWidth
          size="lg"
          title="Sign in"
          variant="accent"
          onPress={() => router.replace("/(auth)/sign-in")}
        />
      </AuthStatus>
    );
  }

  if (state === "gone") {
    return (
      <AuthStatus
        description="This reset link is invalid or has expired."
        icon="clock"
        title="Reset link expired"
        tone="warn"
      >
        <Button
          fullWidth
          title="Request a new reset link"
          onPress={() => router.push("/(auth)/forgot-password")}
        />
      </AuthStatus>
    );
  }

  return (
    <AuthShell
      hasHeader
      description={
        linkToken
          ? undefined
          : "The link in your email opens Zenguy on the web. To reset your password here, paste the token from that link."
      }
      title="Choose a new password"
    >
      <View style={styles.form}>
        {linkToken ? null : (
          <Controller
            control={form.control}
            name="token"
            render={({ field, fieldState }) => (
              <Field
                error={fieldState.error?.message}
                hint="It's the part after “token=” in the reset link."
                label="Reset token"
                required
              >
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  autoFocus
                  invalid={Boolean(fieldState.error)}
                  placeholder="Paste the token from the email"
                  returnKeyType="next"
                  textContentType="none"
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </Field>
            )}
          />
        )}
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field error={fieldState.error?.message} label="New password" required>
              <PasswordInput
                ref={passwordRef}
                autoComplete="new-password"
                autoFocus={linkToken !== null}
                invalid={Boolean(fieldState.error)}
                returnKeyType="next"
                textContentType="newPassword"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                onSubmitEditing={() => confirmPasswordRef.current?.focus()}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="confirmPassword"
          render={({ field, fieldState }) => (
            <Field error={fieldState.error?.message} label="Confirm password" required>
              <PasswordInput
                ref={confirmPasswordRef}
                autoComplete="new-password"
                invalid={Boolean(fieldState.error)}
                returnKeyType="go"
                textContentType="newPassword"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                onSubmitEditing={() => void submit()}
              />
            </Field>
          )}
        />
        <Button
          fullWidth
          loading={form.formState.isSubmitting}
          title="Update password"
          variant="accent"
          onPress={() => void submit()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
});
