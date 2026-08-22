import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePush } from "@/contexts/PushContext";
import { useToast } from "@/contexts/ToastContext";
import { pushPromptBody, pushPromptTitle } from "@/lib/push";
import { colors, radius, spacing } from "@/theme";
import { Button, Muted, Title } from "@/ui";

/**
 * Soft ask shown once per session after the first workspace loads, before the
 * iOS permission dialog. "Not now" keeps quiet until the next launch.
 */
export function PushPrompt() {
  const { dismissPrompt, permission, promptDismissed, requestPermission } = usePush();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const visible = permission === "undetermined" && !promptDismissed;

  const enable = async () => {
    setBusy(true);
    try {
      const granted = await requestPermission();
      if (granted) toast.success("Alerts will arrive on this iPhone");
    } finally {
      setBusy(false);
      dismissPrompt();
    }
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={dismissPrompt}>
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Feather color={colors.accent} name="bell" size={30} />
          </View>
          <Title style={styles.title}>{pushPromptTitle}</Title>
          <Muted style={styles.text}>{pushPromptBody}</Muted>
        </View>
        <View style={styles.actions}>
          <Button fullWidth loading={busy} size="lg" title="Enable notifications" variant="primary" onPress={() => void enable()} />
          <Button fullWidth disabled={busy} title="Not now" variant="ghost" onPress={dismissPrompt} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, padding: spacing.xl },
  body: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing.xl },
  iconWrap: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  sheet: { backgroundColor: colors.surface, flex: 1 },
  text: { marginTop: spacing.sm, textAlign: "center" },
  title: { marginTop: spacing.lg, textAlign: "center" },
});
