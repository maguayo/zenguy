import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "@/theme";
import { Caption, Label, Muted, Small, Text } from "@/ui";
import { planFeatures, planPriceLabel, planPriceSuffix, planRetriesNote } from "./billing-setup";

/** The plan promise shown during billing setup (same copy as the web). */
export function PlanDetails() {
  return (
    <View>
      <View style={styles.header}>
        <Label>Zenguy</Label>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{planPriceLabel}</Text>
          <Muted> {planPriceSuffix}</Muted>
        </View>
      </View>
      <View style={styles.features}>
        {planFeatures.map((feature) => (
          <View key={feature} style={styles.feature}>
            <Feather color={colors.ok} name="check" size={16} style={styles.check} />
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
  check: { marginTop: 1 },
  feature: { flexDirection: "row", gap: spacing.sm },
  featureText: { color: colors.zinc700, flex: 1 },
  features: { gap: spacing.md, marginTop: spacing.xl },
  header: { alignItems: "center" },
  note: { backgroundColor: colors.zinc50, borderRadius: radius.md, marginTop: spacing.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noteText: { textAlign: "center" },
  price: { color: colors.zinc950, fontSize: 34, fontWeight: "600", letterSpacing: -0.5, lineHeight: 40 },
  priceRow: { alignItems: "baseline", flexDirection: "row", marginTop: spacing.sm },
});
