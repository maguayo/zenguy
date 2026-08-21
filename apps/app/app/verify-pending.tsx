import { Redirect, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Pressable, StyleSheet } from "react-native";

import { AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/contexts/AuthContext";
import { useResendVerification } from "@/hooks/useResendVerification";
import { colors } from "@/theme";
import { Button, Label, Muted, Screen, Small, Spinner } from "@/ui";

const POLL_INTERVAL_MS = 10_000;

/** Signed in but not yet verified: waits for the link in the inbox to be used. */
export default function VerifyPending() {
  const { refreshUser, signOut, status, user } = useAuth();
  const router = useRouter();
  const { countdown, resend, sending } = useResendVerification(user?.email ?? "");
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

  if (status === "loading" || (signedIn && user.emailVerified)) {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <Spinner label="Loading Zenguy" size="large" style={styles.fill} />
      </Screen>
    );
  }
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <AuthShell
      description={
        <Muted>
          We sent a verification link to{" "}
          <Small color={colors.zinc700} style={styles.email}>
            {user.email}
          </Small>
          .
        </Muted>
      }
      footer={
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void signOut()}>
          <Label color={colors.accentDark}>Sign out</Label>
        </Pressable>
      }
      title="Verify your email"
    >
      <Button
        disabled={countdown > 0}
        fullWidth
        loading={sending}
        title={countdown > 0 ? `Resend email in ${countdown}s` : "Resend email"}
        onPress={() => void resend()}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  email: { fontWeight: "500" },
  fill: { flex: 1 },
});
