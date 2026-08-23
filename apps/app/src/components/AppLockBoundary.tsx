import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useAppLock } from "@/contexts/AppLockContext";
import { AppLockGate } from "./AppLockGate";

/**
 * Keeps authenticated UI mounted, but removes it from pointer and accessibility
 * navigation until App Lock has finished loading and the device is unlocked.
 */
export function AppLockBoundary({ children }: { children: ReactNode }) {
  const { locked, ready } = useAppLock();
  const concealed = !ready || locked;

  return (
    <>
      <View
        accessibilityElementsHidden={concealed}
        importantForAccessibility={concealed ? "no-hide-descendants" : "auto"}
        pointerEvents={concealed ? "none" : "auto"}
        style={[styles.fill, concealed && styles.concealed]}
        testID="app-lock-protected-content"
      >
        {children}
      </View>
      <AppLockGate />
    </>
  );
}

const styles = StyleSheet.create({
  concealed: { opacity: 0 },
  fill: { flex: 1 },
});
