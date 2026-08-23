import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View, type TextInput } from "react-native";
import { z } from "zod";

import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { safeNextPath } from "@/lib/links";
import { colors, spacing } from "@/theme";
import { Button, Field, Input, Label, Muted, PasswordInput } from "@/ui";

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function SignIn() {
  const { signIn } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const passwordRef = useRef<TextInput>(null);
  const form = useForm<SignInValues>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(signInSchema),
  });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await signIn(values.email.trim(), values.password);
      router.replace(safeNextPath(params.next) ?? "/");
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        form.setError("root", { message: "Incorrect email or password." });
      } else if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        form.setError("root", { message: "Too many attempts. Try again in a moment." });
      } else {
        toast.error(apiErrorMessage(error));
      }
    }
  });

  return (
    <AuthShell
      description="Sign in to your workspace."
      footer={
        <Muted>
          Don&apos;t have an account?{" "}
          <Link href="/(auth)/sign-up">
            <Label color={colors.accentDark}>Sign up</Label>
          </Link>
        </Muted>
      }
      title="Welcome back"
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
                inputMode="email"
                invalid={Boolean(fieldState.error)}
                keyboardType="email-address"
                placeholder="you@company.com"
                returnKeyType="next"
                testID="signin-email"
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
            <Field error={fieldState.error?.message} label="Password" required>
              <PasswordInput
                ref={passwordRef}
                autoComplete="current-password"
                invalid={Boolean(fieldState.error)}
                returnKeyType="go"
                testID="signin-password"
                textContentType="password"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                onSubmitEditing={() => void submit()}
              />
            </Field>
          )}
        />
        <FormError message={form.formState.errors.root?.message} />
        <View style={styles.forgot}>
          <Link href="/(auth)/forgot-password">
            <Label color={colors.accentDark}>Forgot password?</Label>
          </Link>
        </View>
        <Button
          fullWidth
          loading={form.formState.isSubmitting}
          size="lg"
          testID="signin-submit"
          title="Sign in"
          variant="accent"
          onPress={() => void submit()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  forgot: { alignItems: "flex-end" },
  form: { gap: spacing.lg },
});
