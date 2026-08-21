import { StyleSheet, Switch, View } from "react-native";

import { colors, spacing } from "@/theme";
import { Body, Muted } from "./Text";

export function Toggle({
  description,
  disabled = false,
  label,
  onValueChange,
  value,
}: {
  description?: string;
  disabled?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Body style={styles.label}>{label}</Body>
        {description ? <Muted>{description}</Muted> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        trackColor={{ true: colors.accent }}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: "500" },
  row: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  text: { flex: 1, gap: 2 },
});
