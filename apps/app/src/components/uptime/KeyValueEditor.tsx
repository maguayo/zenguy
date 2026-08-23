import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "@/theme";
import { Button, Caption, Input } from "@/ui";

import {
  addKeyValue,
  changeKeyValue,
  removeKeyValue,
  type KeyValueRow,
  type KeyValueRowError,
} from "./key-value";

/** Rows of mono key/value inputs with add/remove, ported from the web editor. */
export function KeyValueEditor({
  addLabel = "Add header",
  errors,
  keyPlaceholder,
  onChange,
  value,
  valuePlaceholder,
}: {
  addLabel?: string;
  errors?: (KeyValueRowError | undefined)[];
  keyPlaceholder: string;
  onChange: (value: KeyValueRow[]) => void;
  value: KeyValueRow[];
  valuePlaceholder: string;
}) {
  return (
    <View style={styles.list}>
      {value.map((row, index) => {
        const error = errors?.[index];
        return (
          <View key={index} style={styles.rowGroup}>
            <View style={styles.row}>
              <Input
                accessibilityLabel={`Header ${index + 1} key`}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                invalid={Boolean(error?.key)}
                mono
                placeholder={keyPlaceholder}
                style={styles.key}
                value={row.key}
                onChangeText={(text) => onChange(changeKeyValue(value, index, "key", text))}
              />
              <Input
                accessibilityLabel={`Header ${index + 1} value`}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                invalid={Boolean(error?.value)}
                mono
                placeholder={valuePlaceholder}
                style={styles.value}
                value={row.value}
                onChangeText={(text) => onChange(changeKeyValue(value, index, "value", text))}
              />
              <Pressable
                accessibilityLabel={`Remove header ${index + 1}`}
                accessibilityRole="button"
                hitSlop={6}
                style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                onPress={() => onChange(removeKeyValue(value, index))}
              >
                <Feather color={colors.zinc600} name="trash-2" size={17} />
              </Pressable>
            </View>
            {error?.key || error?.value ? (
              <Caption accessibilityRole="alert" color={colors.dangerDark}>
                {error.key ?? error.value}
              </Caption>
            ) : null}
          </View>
        );
      })}
      <Button
        icon={<Feather color={colors.ink} name="plus" size={14} />}
        size="sm"
        title={addLabel}
        onPress={() => onChange(addKeyValue(value))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  key: { flex: 0.8 },
  list: { gap: spacing.sm },
  pressed: { backgroundColor: colors.zinc100 },
  remove: {
    alignItems: "center",
    borderRadius: radius.md,
    height: 46,
    justifyContent: "center",
    width: 36,
  },
  row: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  rowGroup: { gap: spacing.xs },
  value: { flex: 1.2 },
});
