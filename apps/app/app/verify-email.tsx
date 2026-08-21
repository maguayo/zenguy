import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import { verifyEmail as verifyEmailRequest } from "@/api/auth";
import { isExpiredLink } from "@/components/auth/link-errors";
import {
  createTokenVerifier,
  verificationEmailSchema,
  type VerificationEmailValues,
  type VerificationState,
} from "@/components/auth/verify-email";
import { AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/contexts/AuthContext";
import { useResendVerification } from "@/hooks/useResendVerification";
import { parseLinkToken } from "@/lib/links";
import { spacing } from "@/theme";
import { Button, ErrorState, Field, Input, Spinner } from "@/ui";

const verifyEmailOnce = createTokenVerifier(verifyEmailRequest);

/** Reachable signed in or signed out: the link in the email has no session. */
export default function VerifyEmail() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = parseLinkToken(params.token);
  const router = useRouter();
  const { refreshUser, status, user } = useAuth();
  const [state, setState] = useState<VerificationState>(token ? "loading" : "gone");
  const [attempt, setAttempt] = useState(0);
  const [continuing, setContinuing] = useState(false);
  const form = useForm<VerificationEmailValues>({
    defaultValues: { email: user?.email ?? "" },
    resolver: zodResolver(verificationEmailSchema),
  });
  const email = form.watch("email");
  const { countdown, resend, sending } = useResendVerification(email);

  useEffect(() => {
    let active = true;
    if (!token) {
      setState("gone");
      return () => {
        active = false;
      };
    }
    setState("loading");
    void verifyEmailOnce(token)
      .then(() => {
        if (active) setState("success");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(isExpiredLink(error) ? "gone" : "error");
      });
    return () => {
      active = false;
    };
  }, [attempt, token]);

  const continueToApp = async () => {
    setContinuing(true);
    try {
      // A signed-in session still carries the unverified user until reloaded.
      if (status === "signedIn") await refreshUser().catch(() => undefined);
    } finally {
      setContinuing(false);
    }
    router.replace("/");
  };

  if (state === "loading") {
    return (
      <AuthShell title="Verifying your email">
        <Spinner label="Verifying email" size="large" style={styles.spinner} />
      </AuthShell>
    );
  }

  if (state === "error") {
    return (
      <AuthShell title="Verify your email">
        <ErrorState onRetry={() => setAttempt((current) => current + 1)} />
      </AuthShell>
    );
  }

  if (state === "success") {
    return (
      <AuthShell description="Your email address is ready to use." title="Email verified">
        <Button
          fullWidth
          loading={continuing}
          title="Continue"
          variant="primary"
          onPress={() => void continueToApp()}
        />
      </AuthShell>
    );
  }

  const submit = form.handleSubmit(async () => resend());
  return (
    <AuthShell
      description="This verification link is invalid or has expired."
      title="Verify your email"
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
          disabled={countdown > 0}
          fullWidth
          loading={sending}
          title={countdown > 0 ? `Resend email in ${countdown}s` : "Resend verification"}
          variant="primary"
          onPress={() => void submit()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  spinner: { minHeight: 96 },
});
