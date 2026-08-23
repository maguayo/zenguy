import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  appLockDescription,
  appLockFailedMessage,
  appLockUnavailableHint,
  appUpdateTraceLabel,
  appVersionLabel,
  lockAfterOptions,
  sessionStorageNote,
  userInitial,
} from "@/components/more/account";
import { toHref } from "@/components/more/links";
import { NotificationsCard } from "@/components/push/NotificationsCard";
import { useAppLock } from "@/contexts/AppLockContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { apiErrorMessage } from "@/lib/errors";
import { colors, spacing } from "@/theme";
import {
  Button,
  Caption,
  Card,
  confirm,
  Field,
  IconTile,
  ListRow,
  MonoSmall,
  Screen,
  SelectSheet,
  Text,
  Title,
  Toggle,
} from "@/ui";

export default function AccountScreen() {
  const router = useRouter();
  const toast = useToast();
  const { signOut, user } = useAuth();
  const { biometricsAvailable, preferences, setEnabled, setThreshold } = useAppLock();
  const [signingOut, setSigningOut] = useState(false);
  const updateTrace = appUpdateTraceLabel(Updates.channel, Updates.updateId);

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
      <Stack.Screen options={{ title: "Account" }} />
      <Screen>
        <View style={styles.stack}>
          <Card elevated padding="lg">
            <View style={styles.profile}>
              <IconTile ink round size={56}>
                <Text color={colors.onInk} style={styles.initial}>
                  {userInitial(user)}
                </Text>
              </IconTile>
              <View style={styles.profileText}>
                <Title numberOfLines={1}>{user?.name || "User"}</Title>
                <MonoSmall numberOfLines={1}>{user?.email}</MonoSmall>
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

          <NotificationsCard />

          <Card eyebrow="About" padding="none">
            <ListRow
              left={<IconTile icon="shield" size={32} />}
              title="Privacy"
              onPress={() => router.push(toHref("/privacy"))}
            />
            <ListRow
              left={<IconTile icon="file-text" size={32} />}
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
          <MonoSmall style={styles.version}>
            {appVersionLabel(Constants.expoConfig?.version, Constants.expoConfig?.ios?.buildNumber)}
          </MonoSmall>
          {updateTrace ? <MonoSmall style={styles.version}>{updateTrace}</MonoSmall> : null}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  initial: { fontSize: 22, fontWeight: "600", lineHeight: 26 },
  lastRow: { borderBottomWidth: 0 },
  lockAfter: { marginTop: spacing.lg },
  note: { marginTop: spacing.lg },
  profile: { alignItems: "center", flexDirection: "row", gap: spacing.lg },
  profileText: { flex: 1, gap: spacing.xs },
  stack: { gap: spacing.xl },
  version: { textAlign: "center" },
});
