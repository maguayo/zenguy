import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { spacing } from "@/theme";
import { Eyebrow } from "./Text";

/** Mono eyebrow that introduces a group of tiles or cards; optional trailing action. */
export function SectionHeader({ action, style, title }: { action?: ReactNode; style?: StyleProp<ViewStyle>; title: string }) {
  return (
    <View style={[styles.row, style]}>
      <Eyebrow>{title}</Eyebrow>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
});
