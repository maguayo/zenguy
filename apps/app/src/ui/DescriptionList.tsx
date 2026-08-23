import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing } from "@/theme";
import { Body, Eyebrow } from "./Text";

export interface DescriptionItem {
  label: string;
  value: ReactNode;
}

/** Key/value rows; labels are mono eyebrows, values read in Geist. */
export function DescriptionList({ items }: { items: DescriptionItem[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.row, index === items.length - 1 && styles.last]}>
          <Eyebrow style={styles.label}>{item.label}</Eyebrow>
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
  label: { flexBasis: 112, flexShrink: 0, paddingTop: 4 },
  last: { borderBottomWidth: 0 },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  value: { flex: 1, minWidth: 0 },
});
