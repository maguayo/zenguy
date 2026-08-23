import { Pressable, ScrollView, StyleSheet } from "react-native";

import { colors, radius, spacing } from "@/theme";
import { Text } from "./Text";

export interface SegmentedTabItem<K extends string> {
  key: K;
  label: string;
}

/** Filter pills: an ink pill slides over a sunken paper track. */
export function SegmentedTabs<K extends string>({
  items,
  onChange,
  value,
}: {
  items: SegmentedTabItem<K>[];
  onChange: (key: K) => void;
  value: K;
}) {
  return (
    <ScrollView contentContainerStyle={styles.row} horizontal showsHorizontalScrollIndicator={false}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && !active && styles.pillPressed]}
            onPress={() => onChange(item.key)}
          >
            <Text color={active ? colors.onInk : colors.zinc600} variant="label">
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillActive: { backgroundColor: colors.ink },
  pillPressed: { backgroundColor: colors.borderStrong },
  row: { flexDirection: "row", gap: spacing.sm },
});
