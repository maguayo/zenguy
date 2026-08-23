import { zodResolver } from "@hookform/resolvers/zod";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useLayoutEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import { SessionStorageError, verifyEmail as verifyEmailRequest } from "@/api/auth";
import { isExpiredLink } from "@/components/auth/link-errors";
import {
  verificationEmailSchema,
  verificationPasswordSchema,
  type VerificationEmailValues,
  type VerificationPasswordValues,
  type VerificationState,
} from "@/components/auth/verify-email";
import { AuthStatus } from "@/components/auth/AuthStatus";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useResendVerification } from "@/hooks/useResendVerification";
import {
  captureLinkCapability,
  forgetLinkCapability,
  linkCapability,
} from "@/lib/link-capabilities";
import { parseLinkFragment } from "@/lib/links";
import { ApiError } from "@/lib/api";
import { clearPendingRegistrationEmail } from "@/lib/registration-pending";
import { spacing } from "@/theme";
import { Button, ErrorState, Field, Input, PasswordInput, Spinner } from "@/ui";

/** Reachable signed in or signed out: the link in the email carries no session. */
export default function VerifyEmail() {
  const params = useLocalSearchParams<{ "#"?: string; token?: string }>();
  const hasIncomingCapability = params.token !== undefined || params["#"] !== undefined;
  if (hasIncomingCapability) {
    return (
      <VerifyEmailLink
        value={params.token ?? parseLinkFragment(params["#"])}
      />
    );
  }
  return <VerifyEmailFlow token={linkCapability("verification")} />;
}

function VerifyEmailLink({ value }: { value: unknown }) {
  const router = useRouter();
  const [token] = useState(() => captureLinkCapability("verification", value));

  useLayoutEffect(() => {
    Linking.clearInitialURL();
    router.replace("/verify-email");
  }, [router]);

  return <VerifyEmailFlow token={token} />;
}

function VerifyEmailFlow({ token }: { token: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const { adoptSession, refreshUser, status, user } = useAuth();
  const [state, setState] = useState<VerificationState>(token ? "ready" : "gone");
  const [continuing, setContinuing] = useState(false);
  const emailForm = useForm<VerificationEmailValues>({
    defaultValues: { email: user?.email ?? "" },
    resolver: zodResolver(verificationEmailSchema),
  });
  const passwordForm = useForm<VerificationPasswordValues>({
    defaultValues: { password: "" },
    resolver: zodResolver(verificationPasswordSchema),
  });
  const email = useWatch({ control: emailForm.control, name: "email" });
  const { countdown, resend, sending } = useResendVerification(email);

  const verify = passwordForm.handleSubmit(async ({ password }) => {
    if (!token) {
      setState("gone");
      return;
    }
    passwordForm.clearErrors();
    setState("loading");
    try {
      const session = await verifyEmailRequest(token, password);
      await adoptSession(session);
      clearPendingRegistrationEmail();
      forgetLinkCapability("verification");
      toast.success("Email verified");
      router.replace("/");
    } catch (error) {
      // The address is verified even when the Keychain refused the session;
      // the user can still continue and sign in by hand.
      if (error instanceof SessionStorageError) {
        clearPendingRegistrationEmail();
        forgetLinkCapability("verification");
        setState("success");
      } else if (isExpiredLink(error)) {
        forgetLinkCapability("verification");
        setState("gone");
      } else if (
        error instanceof ApiError &&
        error.code === "INVALID_CREDENTIALS"
      ) {
        setState("ready");
        passwordForm.setError("password", {
          message: "That is not the password used to create this account.",
        });
      } else if (
        error instanceof ApiError &&
        error.code === "RATE_LIMITED"
      ) {
        setState("ready");
        passwordForm.setError("root", {
          message: "Too many attempts. Try again in a moment.",
        });
      } else {
        setState("error");
      }
    }
  });

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
        <ErrorState onRetry={() => setState(token ? "ready" : "gone")} />
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

  if (state === "ready") {
    return (
      <AuthShell
        hasHeader
        description="Enter the password you chose when creating this account. The email link alone cannot activate it."
        title="Verify your email"
      >
        <View style={styles.form}>
          <Controller
            control={passwordForm.control}
            name="password"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Password" required>
                <PasswordInput
                  autoComplete="current-password"
                  invalid={Boolean(fieldState.error)}
                  returnKeyType="go"
                  testID="verification-password"
                  textContentType="password"
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  onSubmitEditing={() => void verify()}
                />
              </Field>
            )}
          />
          <FormError message={passwordForm.formState.errors.root?.message} />
          <Button
            fullWidth
            loading={passwordForm.formState.isSubmitting}
            size="lg"
            testID="verification-submit"
            title="Verify email"
            variant="accent"
            onPress={() => void verify()}
          />
        </View>
      </AuthShell>
    );
  }

  const submit = emailForm.handleSubmit(async () => resend());
  return (
    <AuthShell
      hasHeader
      description="This verification link is invalid or has expired."
      title="Verify your email"
    >
      <View style={styles.form}>
        <Controller
          control={emailForm.control}
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
