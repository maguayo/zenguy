import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "@/theme";
import { Caption, Eyebrow, Muted, Small, Text } from "@/ui";
import { planFeatures, planPriceLabel, planPriceSuffix, planRetriesNote } from "./billing-setup";

/** The plan promise shown during billing setup (same copy as the web). */
export function PlanDetails() {
  return (
    <View>
      <View style={styles.header}>
        <Eyebrow>Zenguy</Eyebrow>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{planPriceLabel}</Text>
          <Muted> {planPriceSuffix}</Muted>
        </View>
      </View>
      <View style={styles.features}>
        {planFeatures.map((feature) => (
          <View key={feature} style={styles.feature}>
            <View style={styles.check}>
              <Feather color={colors.okDark} name="check" size={13} />
            </View>
            <Small style={styles.featureText}>{feature}</Small>
          </View>
        ))}
      </View>
      <View style={styles.note}>
        <Caption style={styles.noteText}>{planRetriesNote}</Caption>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  check: {
    alignItems: "center",
    backgroundColor: colors.okSoft,
    borderRadius: radius.full,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  feature: { alignItems: "center", flexDirection: "row", gap: spacing.sm + 2 },
  featureText: { color: colors.textBody, flex: 1 },
  features: { gap: spacing.md, marginTop: spacing.xl },
  header: { alignItems: "center" },
  note: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteText: { textAlign: "center" },
  price: { color: colors.ink, fontSize: 40, fontWeight: "700", letterSpacing: -1, lineHeight: 46 },
  priceRow: { alignItems: "baseline", flexDirection: "row", marginTop: spacing.sm },
});
