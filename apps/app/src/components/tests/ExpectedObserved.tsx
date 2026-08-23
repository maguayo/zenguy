import { StyleSheet, View } from "react-native";

import { colors, palette, radius, spacing } from "@/theme";
import { Eyebrow, Small } from "@/ui";

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
        <Eyebrow color={colors.okDark}>Expected</Eyebrow>
        <Small selectable style={styles.value}>
          {expected ?? "—"}
        </Small>
      </View>
      <View style={[styles.box, styles.observed]}>
        <Eyebrow color={colors.dangerDark}>Observed</Eyebrow>
        <Small selectable style={styles.value}>
          {actual ?? "—"}
        </Small>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftColor: palette.green,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.md,
  },
  grid: { gap: spacing.sm, marginTop: spacing.md },
  observed: { borderLeftColor: palette.red },
  value: { color: colors.text },
});
