import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useRouter } from "expo-router";
import { useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, View, type TextInput } from "react-native";

import { register as registerAccount } from "@/api/auth";
import { signUpSchema, type SignUpValues } from "@/components/auth/sign-up";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { setPendingRegistrationEmail } from "@/lib/registration-pending";
import { colors, spacing } from "@/theme";
import { Button, Caption, Field, Input, Label, Muted, PasswordInput, Small } from "@/ui";

export default function SignUp() {
  const router = useRouter();
  const toast = useToast();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const form = useForm<SignUpValues>({
    defaultValues: {
      acceptedTerms: false,
      confirmPassword: "",
      email: "",
      name: "",
      password: "",
    },
    resolver: zodResolver(signUpSchema),
  });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const pending = await registerAccount(
        values.name,
        values.email,
        values.password,
      );
      setPendingRegistrationEmail(pending.email);
      router.replace("/verify-pending");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  });

  return (
    <AuthShell
      hasHeader
      description="Create your account, then activate each workspace securely with Stripe."
      footer={
        <Muted>
          Already have an account?{" "}
          <Link href="/(auth)/sign-in">
            <Label color={colors.accentDark}>Sign in</Label>
          </Link>
        </Muted>
      }
      title="Create your account"
    >
      <View style={styles.form}>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field error={fieldState.error?.message} label="Name" required>
              <Input
                autoCapitalize="words"
                autoComplete="name"
                invalid={Boolean(fieldState.error)}
                placeholder="Ada Lovelace"
                returnKeyType="next"
                textContentType="name"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field error={fieldState.error?.message} label="Email" required>
              <Input
                ref={emailRef}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                inputMode="email"
                invalid={Boolean(fieldState.error)}
                keyboardType="email-address"
                placeholder="you@company.com"
                returnKeyType="next"
                textContentType="username"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field
              error={fieldState.error?.message}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              label="Password"
              required
            >
              <PasswordInput
                ref={passwordRef}
                autoComplete="new-password"
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
        <Controller
          control={form.control}
          name="acceptedTerms"
          render={({ field, fieldState }) => (
            <View style={styles.terms}>
              <Pressable
                accessibilityLabel="I accept the Terms of Service and Privacy Policy"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: field.value }}
                hitSlop={8}
                style={styles.termsRow}
                onPress={() => field.onChange(!field.value)}
              >
                <Feather
                  color={
                    fieldState.error ? colors.danger : field.value ? colors.accent : colors.textSubtle
                  }
                  name={field.value ? "check-square" : "square"}
                  size={22}
                />
                <Small color={colors.textBody} style={styles.termsText}>
                  I accept the{" "}
                  <Link href="/terms">
                    <Label color={colors.accentDark}>Terms of Service</Label>
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy">
                    <Label color={colors.accentDark}>Privacy Policy</Label>
                  </Link>
                </Small>
              </Pressable>
              {fieldState.error?.message ? (
                <Caption accessibilityRole="alert" color={colors.danger} style={styles.termsError}>
                  {fieldState.error.message}
                </Caption>
              ) : null}
            </View>
          )}
        />
        <FormError message={form.formState.errors.root?.message} />
        <Button
          fullWidth
          loading={form.formState.isSubmitting}
          size="lg"
          title="Create account"
          variant="accent"
          onPress={() => void submit()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  terms: { gap: spacing.xs },
  termsError: { marginLeft: 22 + spacing.sm },
  termsRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  termsText: { flex: 1, paddingTop: 2 },
});
