import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";

import { colors } from "@/theme";
import { Wordmark } from "./AuthShell";

/**
 * Covers the UI whenever the app is not active so the iOS app switcher
 * snapshot never shows workspace data (secrets metadata, evidence, members).
 */
export function PrivacyShield() {
  const [active, setActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  if (active) return null;
  return (
    <View accessibilityElementsHidden pointerEvents="none" style={styles.shield}>
      <Wordmark dark size={28} />
    </View>
  );
}

const styles = StyleSheet.create({
  shield: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    alignItems: "center",
    backgroundColor: colors.zinc950,
    justifyContent: "center",
    zIndex: 1000,
  },
});
