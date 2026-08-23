import type { ReactNode } from "react";
import { Feather } from "@expo/vector-icons";
import { ActionSheetIOS, Pressable, StyleSheet } from "react-native";

import { colors, radius } from "@/theme";

export interface ActionMenuItem {
  destructive?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}

export function showActionMenu(items: ActionMenuItem[], title?: string): void {
  const enabled = items.filter((item) => !item.disabled);
  if (enabled.length === 0) return;
  const destructiveIndexes = enabled
    .map((item, index) => (item.destructive ? index : -1))
    .filter((index) => index >= 0);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      cancelButtonIndex: enabled.length,
      destructiveButtonIndex: destructiveIndexes.length > 0 ? destructiveIndexes : undefined,
      options: [...enabled.map((item) => item.label), "Cancel"],
      title,
    },
    (index) => {
      enabled[index]?.onSelect();
    },
  );
}

/** A "…" trigger that opens the iOS action sheet with the given items. */
export function ActionMenu({
  accessibilityLabel = "More actions",
  items,
  title,
  trigger,
}: {
  accessibilityLabel?: string;
  items: ActionMenuItem[];
  title?: string;
  trigger?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      onPress={() => showActionMenu(items, title)}
    >
      {trigger ?? <Feather color={colors.zinc600} name="more-horizontal" size={20} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.zinc100 },
  trigger: { alignItems: "center", borderRadius: radius.full, height: 36, justifyContent: "center", width: 36 },
});
