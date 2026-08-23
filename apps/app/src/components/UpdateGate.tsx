import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Linking, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getAppRequirements } from "@/api/app";
import { isAppStoreUrl, isUpdateRequired } from "@/lib/app-version";
import { colors, spacing } from "@/theme";
import { Button, IconTile, MonoSmall, Muted, Title } from "@/ui";
import { Wordmark } from "./AuthShell";

export const updateRequiredTitle = "Update required";
export const updateRequiredMessage =
  "This version of Zenguy is no longer supported. Update the app to keep monitoring your workspaces.";

/**
 * Blocks the whole app when the API's MIN_APP_VERSION is newer than this
 * build. Checked on launch and whenever the app returns to the foreground;
 * a network failure never blocks the app.
 */
export function UpdateGate() {
  const requirements = useQuery({
    queryFn: getAppRequirements,
    queryKey: ["app-version"],
    refetchInterval: 15 * 60_000,
    staleTime: 5 * 60_000,
  });
  const currentVersion = Constants.expoConfig?.version ?? null;

  if (!requirements.data || !isUpdateRequired(currentVersion, requirements.data.minVersion)) {
    return null;
  }
  const storeUrl = requirements.data.storeUrl;

  return (
    <View style={styles.cover}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
        <Wordmark />
        <View style={styles.body}>
          <IconTile icon="download-cloud" size={56} tone="accent" />
          <Title style={styles.title}>{updateRequiredTitle}</Title>
          <Muted style={styles.message}>{updateRequiredMessage}</Muted>
          <View style={styles.actions}>
            {isAppStoreUrl(storeUrl) ? (
              <Button
                fullWidth
                size="lg"
                title="Open the App Store"
                variant="accent"
                onPress={() => void Linking.openURL(storeUrl).catch(() => undefined)}
              />
            ) : (
              <Muted style={styles.message}>Update Zenguy from the App Store.</Muted>
            )}
            <Button
              fullWidth
              loading={requirements.isFetching}
              title="Check again"
              variant="ghost"
              onPress={() => void requirements.refetch()}
            />
          </View>
        </View>
        <MonoSmall style={styles.version}>
          Installed {currentVersion ?? "unknown"} · required {requirements.data.minVersion}
        </MonoSmall>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.xl },
  body: { alignItems: "center", flex: 1, justifyContent: "center" },
  cover: {
    backgroundColor: colors.bg,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 990,
  },
  message: { fontSize: 16, lineHeight: 22, marginTop: spacing.sm, maxWidth: 320, textAlign: "center" },
  safe: { flex: 1, padding: spacing.xl },
  title: { marginTop: spacing.lg, textAlign: "center" },
  version: { textAlign: "center" },
});
