import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { colors, spacing } from "@/theme";
import { Button, Card, IconTile, Muted, Screen, Title } from "@/ui";

/** Neutral companion-app state: it never turns missing access into a purchase funnel. */
export default function AccessUnavailableScreen() {
  const { signOut, status } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // AuthContext still clears the device session when the API is unavailable.
    } finally {
      setSigningOut(false);
    }
    router.replace("/(auth)/sign-in");
  };

  return (
    <Screen safe={["top", "bottom"]}>
      <View style={styles.wrap}>
        <Card elevated padding="lg">
          <View style={styles.content}>
            <IconTile icon="shield" size={44} tone="warn" />
            <Title>Mobile access unavailable</Title>
            <Muted style={styles.copy}>
              This account does not currently have an active Zenguy workspace available on
              iOS. Ask your organization administrator to assign access, then check again.
            </Muted>
            <Muted style={styles.copy}>
              Zenguy for iOS is a companion app for existing accounts. Accounts and
              workspaces cannot be created here.
            </Muted>
          </View>
        </Card>
        <Button
          fullWidth
          title="Check again"
          variant="primary"
          onPress={() => router.replace("/")}
        />
        <Button
          fullWidth
          loading={signingOut}
          title="Sign out"
          variant="ghost"
          onPress={() => void handleSignOut()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", gap: spacing.md },
  copy: { color: colors.textBody, textAlign: "center" },
  wrap: { flex: 1, gap: spacing.md, justifyContent: "center" },
});
