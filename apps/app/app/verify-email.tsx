import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import { SessionStorageError, verifyEmail as verifyEmailRequest } from "@/api/auth";
import { isExpiredLink } from "@/components/auth/link-errors";
import {
  createTokenVerifier,
  verificationEmailSchema,
  type VerificationEmailValues,
  type VerificationState,
} from "@/components/auth/verify-email";
import { AuthStatus } from "@/components/auth/AuthStatus";
import { AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useResendVerification } from "@/hooks/useResendVerification";
import { parseLinkToken } from "@/lib/links";
import { spacing } from "@/theme";
import { Button, ErrorState, Field, Input, Spinner } from "@/ui";

const verifyEmailOnce = createTokenVerifier(verifyEmailRequest);

/** Reachable signed in or signed out: the link in the email carries no session. */
export default function VerifyEmail() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = parseLinkToken(params.token);
  const router = useRouter();
  const toast = useToast();
  const { adoptSession, refreshUser, status, user } = useAuth();
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
      .then((session) => {
        if (!active) return;
        // Using the link proves control of the inbox: this device is signed in
        // and continues into the app instead of the password form.
        adoptSession(session);
        toast.success("Email verified");
        router.replace("/");
      })
      .catch((error: unknown) => {
        if (!active) return;
        // The address is verified even when the Keychain refused the session;
        // the user can still continue and sign in by hand.
        if (error instanceof SessionStorageError) {
          setState("success");
          return;
        }
        setState(isExpiredLink(error) ? "gone" : "error");
      });
    return () => {
      active = false;
    };
  }, [adoptSession, attempt, router, toast, token]);

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
      <AuthStatus icon="mail" title="Verifying your email">
        <Spinner label="Verifying email" size="large" style={styles.spinner} />
      </AuthStatus>
    );
  }

  if (state === "error") {
    return (
      <AuthStatus icon="mail" title="Verify your email" tone="warn">
        <ErrorState onRetry={() => setAttempt((current) => current + 1)} />
      </AuthStatus>
    );
  }

  if (state === "success") {
    return (
      <AuthStatus
        description="Your email address is ready to use."
        icon="check"
        title="Email verified"
        tone="ok"
      >
        <Button
          fullWidth
          loading={continuing}
          size="lg"
          title="Continue"
          variant="accent"
          onPress={() => void continueToApp()}
        />
      </AuthStatus>
    );
  }

  const submit = form.handleSubmit(async () => resend());
  return (
    <AuthShell
      hasHeader
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
          variant="accent"
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
