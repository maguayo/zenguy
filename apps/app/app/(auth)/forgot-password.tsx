import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import { forgotPassword } from "@/api/auth";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/components/auth/password-flows";
import { AuthShell } from "@/components/AuthShell";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { colors, spacing } from "@/theme";
import { Button, Field, Input, Label, Muted, Small } from "@/ui";

export default function ForgotPassword() {
  const toast = useToast();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPasswordValues>({
    defaultValues: { email: "" },
    resolver: zodResolver(forgotPasswordSchema),
  });

  const submit = form.handleSubmit(async ({ email }) => {
    try {
      await forgotPassword(email);
      setSentTo(email);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  });

  const footer = (
    <Link href="/(auth)/sign-in">
      <Label color={colors.accentDark}>Back to sign in</Label>
    </Link>
  );

  if (sentTo) {
    return (
      <AuthShell
        description={
          <Muted>
            If an account exists for{" "}
            <Small color={colors.zinc700} style={styles.email}>
              {sentTo}
            </Small>
            , we&apos;ve sent a reset link.
          </Muted>
        }
        footer={footer}
        title="Check your inbox"
      >
        <Muted style={styles.note}>The link expires for your security.</Muted>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description="Enter your email and we'll send you a reset link."
      footer={footer}
      title="Forgot password?"
    >
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
                placeholder="you@company.com"
                returnKeyType="send"
                textContentType="username"
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
          title="Send reset link"
          variant="primary"
          onPress={() => void submit()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  email: { fontWeight: "500" },
  form: { gap: spacing.lg },
  note: { textAlign: "center" },
});
