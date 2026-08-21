import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  appLockDescription,
  appLockFailedMessage,
  appLockUnavailableHint,
  appVersionLabel,
  lockAfterOptions,
  sessionStorageNote,
  userInitial,
} from "@/components/more/account";
import { toHref } from "@/components/more/links";
import { useAppLock } from "@/contexts/AppLockContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, radius, spacing } from "@/theme";
import {
  Button,
  Caption,
  Card,
  confirm,
  Field,
  Heading,
  ListRow,
  Muted,
  Screen,
  SelectSheet,
  Toggle,
} from "@/ui";

function RowIcon({ name }: { name: "file-text" | "shield" }) {
  return (
    <View style={styles.icon}>
      <Feather color={colors.zinc600} name={name} size={18} />
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const toast = useToast();
  const { signOut, user } = useAuth();
  const { biometricsAvailable, preferences, setEnabled, setThreshold } = useAppLock();
  const [signingOut, setSigningOut] = useState(false);

  const toggleLock = async (enabled: boolean) => {
    try {
      // setEnabled resolves false when the Face ID / Touch ID prompt was cancelled;
      // the preference is left untouched so the toggle stays where it was.
      if (!(await setEnabled(enabled))) toast.error(appLockFailedMessage);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const changeThreshold = async (threshold: (typeof lockAfterOptions)[number]["value"]) => {
    try {
      await setThreshold(threshold);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const handleSignOut = async () => {
    const accepted = await confirm({
      confirmLabel: "Sign out",
      destructive: true,
      message: "You'll need to sign in again on this device.",
      title: "Sign out?",
    });
    if (!accepted) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // The local session is cleared even when the server could not be reached.
    } finally {
      setSigningOut(false);
    }
    router.replace("/(auth)/sign-in");
  };

  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "Account" }} />
      <Screen>
        <View style={styles.stack}>
          <Card>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <Heading color={colors.accentDark}>{userInitial(user)}</Heading>
              </View>
              <View style={styles.profileText}>
                <Heading numberOfLines={1}>{user?.name || "User"}</Heading>
                <Muted numberOfLines={1}>{user?.email}</Muted>
              </View>
            </View>
          </Card>

          <Card title="App Lock">
            <Toggle
              description={biometricsAvailable ? appLockDescription : appLockUnavailableHint}
              disabled={!biometricsAvailable}
              label="Require Face ID / Touch ID"
              value={preferences.enabled}
              onValueChange={(value) => void toggleLock(value)}
            />
            {preferences.enabled ? (
              <View style={styles.lockAfter}>
                <Field label="Lock after">
                  <SelectSheet
                    options={lockAfterOptions}
                    title="Lock after"
                    value={preferences.threshold}
                    onChange={(threshold) => void changeThreshold(threshold)}
                  />
                </Field>
              </View>
            ) : null}
            <Caption style={styles.note}>{sessionStorageNote}</Caption>
          </Card>

          <Card padding="none">
            <ListRow
              left={<RowIcon name="shield" />}
              title="Privacy"
              onPress={() => router.push(toHref("/privacy"))}
            />
            <ListRow
              left={<RowIcon name="file-text" />}
              style={styles.lastRow}
              title="Terms"
              onPress={() => router.push(toHref("/terms"))}
            />
          </Card>

          <Button
            fullWidth
            loading={signingOut}
            title="Sign out"
            variant="danger"
            onPress={() => void handleSignOut()}
          />
          <Caption style={styles.version}>
            {appVersionLabel(Constants.expoConfig?.version, Constants.expoConfig?.ios?.buildNumber)}
          </Caption>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  icon: {
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  lastRow: { borderBottomWidth: 0 },
  lockAfter: { marginTop: spacing.lg },
  note: { marginTop: spacing.lg },
  profile: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  profileText: { flex: 1, gap: 2 },
  stack: { gap: spacing.lg },
  version: { textAlign: "center" },
});
