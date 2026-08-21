import { useEffect, useRef } from "react";
import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { useAppLock } from "@/contexts/AppLockContext";
import { colors, spacing } from "@/theme";
import { Button, Muted, Title } from "@/ui";
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
    <View style={styles.cover}>
      <Wordmark dark size={28} />
      <View style={styles.body}>
        <Feather color={colors.zinc400} name="lock" size={28} />
        <Title color={colors.white} style={styles.title}>
          Zenguy is locked
        </Title>
        <Muted color={colors.zinc400}>Unlock with Face ID, Touch ID or your passcode.</Muted>
        <Button
          style={styles.button}
          title="Unlock"
          variant="primary"
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
  button: { marginTop: spacing.lg },
  cover: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    alignItems: "center",
    backgroundColor: colors.zinc950,
    justifyContent: "center",
    padding: spacing.xl,
    zIndex: 999,
  },
  title: { marginTop: spacing.sm },
});
