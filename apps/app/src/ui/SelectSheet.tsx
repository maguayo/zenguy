import { useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import {
  ActionSheetIOS,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, controlHeight, radius, spacing } from "@/theme";
import { Button } from "./Button";
import { Input } from "./Input";
import { Body, Heading, Muted } from "./Text";

export interface SelectOption<V extends string | number> {
  description?: string;
  label: string;
  value: V;
}

const SHEET_LIMIT = 8;

/**
 * A native-feeling select: short lists open the iOS action sheet, long lists
 * (timezones, members) open a searchable full-screen picker.
 */
export function SelectSheet<V extends string | number>({
  accessibilityLabel,
  disabled = false,
  invalid = false,
  onChange,
  options,
  placeholder = "Select…",
  searchable,
  title,
  value,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  searchable?: boolean;
  title?: string;
  value: V | null;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const selected = options.find((option) => option.value === value);
  const useModal = searchable ?? options.length > SHEET_LIMIT;
  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return needle ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle)) : options;
  }, [filter, options]);

  const openPicker = () => {
    if (disabled) return;
    if (useModal) {
      setFilter("");
      setOpen(true);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: options.length,
        options: [...options.map((option) => option.label), "Cancel"],
        title,
      },
      (index) => {
        const option = options[index];
        if (option) onChange(option.value);
      },
    );
  };

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        disabled={disabled}
        style={({ pressed }) => [
          styles.trigger,
          invalid && styles.invalid,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
        onPress={openPicker}
      >
        <Body color={selected ? colors.text : colors.zinc400} numberOfLines={1} style={styles.triggerText}>
          {selected?.label ?? placeholder}
        </Body>
        <Feather color={colors.zinc500} name="chevron-down" size={18} />
      </Pressable>
      <Modal animationType="slide" presentationStyle="pageSheet" visible={open} onRequestClose={() => setOpen(false)}>
        <SafeAreaView edges={["bottom"]} style={styles.modal}>
          <View style={styles.modalHeader}>
            <Heading>{title ?? "Select"}</Heading>
            <Button title="Done" variant="ghost" onPress={() => setOpen(false)} />
          </View>
          <View style={styles.search}>
            <Input
              accessibilityLabel="Filter options"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              clearButtonMode="while-editing"
              placeholder="Search"
              value={filter}
              onChangeText={setFilter}
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.value)}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Muted style={styles.empty}>No matches.</Muted>}
            renderItem={({ item }) => {
              const active = item.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <View style={styles.optionText}>
                    <Body color={active ? colors.accentDark : colors.text}>{item.label}</Body>
                    {item.description ? <Muted>{item.description}</Muted> : null}
                  </View>
                  {active ? <Feather color={colors.accent} name="check" size={18} /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.55 },
  empty: { padding: spacing.xl, textAlign: "center" },
  invalid: { borderColor: colors.danger },
  modal: { backgroundColor: colors.surface, flex: 1 },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingTop: spacing.md,
  },
  option: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  optionText: { flex: 1 },
  pressed: { backgroundColor: colors.zinc50 },
  search: { padding: spacing.lg, paddingTop: spacing.sm },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.zinc300,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    height: controlHeight.md,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  triggerText: { flex: 1, marginRight: spacing.sm },
});
