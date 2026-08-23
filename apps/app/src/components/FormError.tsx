import { StyleSheet, View } from "react-native";

import { colors, palette, radius, spacing } from "@/theme";
import { Small } from "@/ui";

/** Form-level (root) error, mirroring the web's danger callout. */
export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.box}>
      <Small color={colors.dangerDark}>{message}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.dangerSoft,
    borderColor: palette.redLine,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: spacing.md - 2,
  },
});
