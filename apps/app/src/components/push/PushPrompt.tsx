import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePush } from "@/contexts/PushContext";
import { useToast } from "@/contexts/ToastContext";
import { pushPromptBody, pushPromptTitle } from "@/lib/push";
import { colors, gutter, spacing } from "@/theme";
import { Button, Card, IconTile, Muted, Title } from "@/ui";

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
          <Card elevated padding="lg">
            <View style={styles.content}>
              <IconTile icon="bell" round size={56} tone="accent" />
              <Title style={styles.title}>{pushPromptTitle}</Title>
              <Muted style={styles.text}>{pushPromptBody}</Muted>
            </View>
          </Card>
        </View>
        <View style={styles.actions}>
          <Button fullWidth loading={busy} size="lg" title="Enable notifications" variant="accent" onPress={() => void enable()} />
          <Button fullWidth disabled={busy} title="Not now" variant="ghost" onPress={dismissPrompt} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, paddingBottom: spacing.lg, paddingHorizontal: gutter, paddingTop: spacing.md },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: gutter },
  content: { alignItems: "center" },
  sheet: { backgroundColor: colors.bg, flex: 1 },
  text: { fontSize: 16, lineHeight: 22, marginTop: spacing.sm, textAlign: "center" },
  title: { marginTop: spacing.lg, textAlign: "center" },
});
