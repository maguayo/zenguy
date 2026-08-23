import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Redirect, useRouter } from "expo-router";
import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { AppState, Pressable, StyleSheet, View } from "react-native";

import { AuthStatus } from "@/components/auth/AuthStatus";
import {
  verificationEmailSchema,
  type VerificationEmailValues,
} from "@/components/auth/verify-email";
import { useAuth } from "@/contexts/AuthContext";
import { useResendVerification } from "@/hooks/useResendVerification";
import { getPendingRegistrationEmail } from "@/lib/registration-pending";
import { colors } from "@/theme";
import { Button, Field, Input, Label, Muted, Screen, Small, Spinner } from "@/ui";

const POLL_INTERVAL_MS = 10_000;

/** Public/token-free after registration; legacy signed-in users also keep polling. */
export default function VerifyPending() {
  const { refreshUser, signOut, status, user } = useAuth();
  const router = useRouter();
  const form = useForm<VerificationEmailValues>({
    defaultValues: {
      email: user?.email ?? getPendingRegistrationEmail() ?? "",
    },
    resolver: zodResolver(verificationEmailSchema),
  });
  const email = useWatch({ control: form.control, name: "email" });
  const { countdown, resend, sending } = useResendVerification(email);
  const signedIn = status === "signedIn" && user !== null;

  useEffect(() => {
    if (!signedIn) return undefined;
    let polling = false;
    const check = () => {
      if (polling) return;
      polling = true;
      void refreshUser()
        .then((nextUser) => {
          if (nextUser.emailVerified) router.replace("/");
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    };
    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    // Coming back from the mail app is when the link was most likely tapped.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refreshUser, router, signedIn]);

  if (status === "loading") {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <Spinner label="Loading Zenguy" size="large" style={styles.fill} />
      </Screen>
    );
  }
  if (signedIn && user.emailVerified) return <Redirect href="/" />;

  const submit = form.handleSubmit(async () => resend());

  return (
    <AuthStatus
      description={
        <Muted style={styles.lead}>
          {email.length > 0 ? (
            <>
              We sent a verification link to{" "}
              <Small color={colors.textBody} style={styles.email}>
                {email}
              </Small>
              .
            </>
          ) : (
            "Enter your email to resend the verification link."
          )}
        </Muted>
      }
      footer={
        signedIn ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void signOut()}
          >
            <Label color={colors.accentDark}>Sign out</Label>
          </Pressable>
        ) : (
          <Link href="/(auth)/sign-in">
            <Label color={colors.accentDark}>Sign in</Label>
          </Link>
        )
      }
      icon="mail"
      title="Verify your email"
    >
      <Muted>
        Open the link on this phone or anywhere else, then enter the password
        you chose during registration. This screen moves on after verification.
      </Muted>
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
          title={countdown > 0 ? `Resend email in ${countdown}s` : "Resend email"}
          onPress={() => void submit()}
        />
      </View>
    </AuthStatus>
  );
}

const styles = StyleSheet.create({
  email: { fontSize: 16, fontWeight: "500", lineHeight: 22 },
  fill: { flex: 1 },
  form: { gap: 16 },
  lead: { fontSize: 16, lineHeight: 22 },
});
