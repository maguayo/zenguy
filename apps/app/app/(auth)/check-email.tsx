import { Link, useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native";

import { AuthShell } from "@/components/AuthShell";
import { useResendVerification } from "@/hooks/useResendVerification";
import { firstParam } from "@/lib/links";
import { colors } from "@/theme";
import { Button, Label, Muted, Small } from "@/ui";

export default function CheckEmail() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = firstParam(params.email)?.trim() ?? "";
  const { countdown, resend, sending } = useResendVerification(email);

  return (
    <AuthShell
      description={
        <Muted>
          We sent a verification link to{" "}
          <Small color={colors.zinc700} style={styles.email}>
            {email || "your email address"}
          </Small>
          .
        </Muted>
      }
      footer={
        <Link href="/(auth)/sign-in">
          <Label color={colors.accentDark}>Back to sign in</Label>
        </Link>
      }
      title="Check your inbox"
    >
      <Button
        disabled={!email || countdown > 0}
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
});
