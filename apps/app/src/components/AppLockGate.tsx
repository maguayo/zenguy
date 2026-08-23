import { useEffect, useRef } from "react";
import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { useAppLock } from "@/contexts/AppLockContext";
import { colors, spacing } from "@/theme";
import { Button, IconTile, Muted, Title } from "@/ui";
import { Wordmark } from "./AuthShell";

/** Full-screen cover shown while App Lock requires Face ID / passcode. */
export function AppLockGate() {
  const { locked, ready, unlock } = useAppLock();
  const prompting = useRef(false);

  useEffect(() => {
    if (!ready || !locked || prompting.current) return;
    prompting.current = true;
    void unlock().finally(() => {
      prompting.current = false;
    });
  }, [locked, ready, unlock]);

  if (!ready || !locked) return null;
  return (
    <View
      accessibilityLabel="Zenguy is locked"
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={styles.cover}
    >
      <Wordmark dark size={28} />
      <View style={styles.body}>
        <IconTile size={56} style={styles.tile}>
          <Feather color={colors.onInkMuted} name="lock" size={24} />
        </IconTile>
        <Title color={colors.onInk} style={styles.title}>
          Zenguy is locked
        </Title>
        <Muted color={colors.onInkMuted} style={styles.message}>
          Unlock with Face ID, Touch ID or your passcode.
        </Muted>
        <Button
          size="lg"
          style={styles.button}
          title="Unlock"
          variant="accent"
          onPress={() => {
            if (prompting.current) return;
            prompting.current = true;
            void unlock().finally(() => {
              prompting.current = false;
            });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xxl },
  button: { marginTop: spacing.lg, minWidth: 200 },
  cover: {
    alignItems: "center",
    backgroundColor: colors.ink,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: spacing.xl,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 999,
  },
  message: { textAlign: "center" },
  tile: { backgroundColor: colors.inkCard, marginBottom: spacing.sm },
  title: { marginTop: spacing.sm },
});
