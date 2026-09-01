import * as Application from "expo-application";
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
import { FormError } from "@/components/FormError";
import { useAppLock } from "@/contexts/AppLockContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { colors, spacing } from "@/theme";
import {
  Button,
  Caption,
  Card,
  confirm,
  Field,
  IconTile,
  Input,
  ListRow,
  MonoSmall,
  Muted,
  PasswordInput,
  Screen,
  SelectSheet,
  Text,
  Title,
  Toggle,
} from "@/ui";

export default function AccountScreen() {
  const router = useRouter();
  const toast = useToast();
  const { deleteAccount, signOut, user } = useAuth();
  const { biometricsAvailable, preferences, setEnabled, setThreshold } = useAppLock();
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);
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

  const closeDeletion = () => {
    setDeleteOpen(false);
    setDeleteConfirmation("");
    setDeletePassword("");
    setDeleteError(undefined);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE" || deletePassword.length === 0) return;
    const accepted = await confirm({
      confirmLabel: "Delete account",
      destructive: true,
      message:
        "This permanently deletes your account and every workspace you own. It cannot be undone.",
      title: "Delete your account?",
    });
    if (!accepted) return;
    setDeleteError(undefined);
    setDeleting(true);
    try {
      await deleteAccount(deletePassword);
      toast.success("Account deleted");
      router.replace("/(auth)/sign-in");
    } catch (error) {
      if (error instanceof ApiError && error.code === "FORBIDDEN") {
        setDeleteError("Password is incorrect.");
      } else if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        setDeleteError("Too many attempts. Try again in a moment.");
      } else {
        setDeleteError(apiErrorMessage(error));
      }
    } finally {
      setDeleting(false);
    }
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

          <Card title="Delete account" tone="danger">
            <Muted>
              Permanently deletes this account, revokes every session, removes you from
              other organizations, and deletes every workspace you own. Retained legal or
              financial records are anonymized and kept only where required by law.
            </Muted>
            {deleteOpen ? (
              <View style={styles.deletionForm}>
                <Field hint="Type DELETE in capitals." label="Confirmation" required>
                  <Input
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="DELETE"
                    testID="delete-account-confirmation"
                    value={deleteConfirmation}
                    onChangeText={setDeleteConfirmation}
                  />
                </Field>
                <Field label="Current password" required>
                  <PasswordInput
                    autoComplete="current-password"
                    testID="delete-account-password"
                    textContentType="password"
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                  />
                </Field>
                <FormError message={deleteError} />
                <View style={styles.deletionActions}>
                  <Button disabled={deleting} title="Cancel" onPress={closeDeletion} />
                  <Button
                    disabled={deleteConfirmation !== "DELETE" || deletePassword.length === 0}
                    loading={deleting}
                    testID="delete-account-submit"
                    title="Delete account"
                    variant="danger"
                    onPress={() => void handleDeleteAccount()}
                  />
                </View>
              </View>
            ) : (
              <Button
                style={styles.deleteButton}
                title="Delete my account…"
                variant="danger"
                onPress={() => setDeleteOpen(true)}
              />
            )}
          </Card>

          <Button
            fullWidth
            loading={signingOut}
            title="Sign out"
            variant="danger"
            onPress={() => void handleSignOut()}
          />
          <MonoSmall style={styles.version}>
            {appVersionLabel(
              Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
              Application.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber,
            )}
          </MonoSmall>
          {updateTrace ? <MonoSmall style={styles.version}>{updateTrace}</MonoSmall> : null}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  deleteButton: { marginTop: spacing.lg },
  deletionActions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  deletionForm: { gap: spacing.md, marginTop: spacing.lg },
  initial: { fontSize: 22, fontWeight: "600", lineHeight: 26 },
  lastRow: { borderBottomWidth: 0 },
  lockAfter: { marginTop: spacing.lg },
  note: { marginTop: spacing.lg },
  profile: { alignItems: "center", flexDirection: "row", gap: spacing.lg },
  profileText: { flex: 1, gap: spacing.xs },
  stack: { gap: spacing.xl },
  version: { textAlign: "center" },
});
