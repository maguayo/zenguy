import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "@/theme";
import { Caption, Small } from "@/ui";

/** Expected vs. observed result of a failed attempt, as on the web. */
export function ExpectedObserved({
  actual,
  expected,
}: {
  actual: string | null;
  expected: string | null;
}) {
  return (
    <View style={styles.grid}>
      <View style={styles.box}>
        <Caption style={styles.label}>Expected</Caption>
        <Small selectable style={styles.value}>
          {expected ?? "—"}
        </Small>
      </View>
      <View style={[styles.box, styles.observed]}>
        <Caption style={styles.label}>Observed</Caption>
        <Small selectable style={styles.value}>
          {actual ?? "—"}
        </Small>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  grid: { gap: spacing.sm, marginTop: spacing.md },
  label: { fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  observed: { borderColor: "#fecaca" },
  value: { color: colors.zinc800, marginTop: 2 },
});
