import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing } from "@/theme";
import { Body, Muted } from "./Text";

export interface DescriptionItem {
  label: string;
  value: ReactNode;
}

export function DescriptionList({ items }: { items: DescriptionItem[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.row, index === items.length - 1 && styles.last]}>
          <Muted style={styles.label}>{item.label}</Muted>
          <View style={styles.value}>
            {typeof item.value === "string" || typeof item.value === "number" ? (
              <Body selectable>{item.value}</Body>
            ) : (
              item.value
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flexBasis: 120, flexShrink: 0, paddingTop: 2 },
  last: { borderBottomWidth: 0 },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  value: { flex: 1, minWidth: 0 },
});
