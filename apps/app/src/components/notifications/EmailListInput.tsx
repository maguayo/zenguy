import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";

import { colors, controlHeight, radius, spacing } from "@/theme";
import { Caption, Input, Small } from "@/ui";

import { addEmails, removeEmail } from "./email-list";

/**
 * Email recipients as removable chips. A comma or the return key commits the
 * draft; backspace on an empty draft removes the last address (like the web).
 */
export function EmailListInput({
  invalid = false,
  max = 10,
  onChange,
  value,
}: {
  invalid?: boolean;
  max?: number;
  onChange: (emails: string[]) => void;
  value: string[];
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const commit = (input: string) => {
    const result = addEmails(value, input, max);
    setLocalError(result.error);
    if (result.error) {
      setDraft(input.replaceAll(",", ""));
      return;
    }
    onChange(result.emails);
    setDraft("");
  };

  const handleChangeText = (text: string) => {
    setLocalError(null);
    if (text.includes(",")) commit(text);
    else setDraft(text);
  };

  const handleKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (event.nativeEvent.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const showInvalid = invalid || Boolean(localError);

  return (
    <View>
      <View style={[styles.box, showInvalid && styles.invalid]}>
        {value.map((email) => (
          <View key={email} style={styles.chip}>
            <Small numberOfLines={1} style={styles.chipText}>
              {email}
            </Small>
            <Pressable
              accessibilityLabel={`Remove ${email}`}
              accessibilityRole="button"
              hitSlop={6}
              style={styles.remove}
              onPress={() => onChange(removeEmail(value, email))}
            >
              <Feather color={colors.zinc500} name="x" size={13} />
            </Pressable>
          </View>
        ))}
        <Input
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          inputMode="email"
          invalid={false}
          keyboardType="email-address"
          placeholder={value.length === 0 ? "alerts@example.com" : "Add another email"}
          returnKeyType="done"
          style={styles.input}
          submitBehavior="submit"
          textContentType="emailAddress"
          value={draft}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onSubmitEditing={() => commit(draft)}
        />
      </View>
      {localError ? (
        <Caption accessibilityRole="alert" color={colors.danger} style={styles.error}>
          {localError}
        </Caption>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.zinc300,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    minHeight: controlHeight.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chip: {
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.sm,
    flexDirection: "row",
    maxWidth: "100%",
    paddingLeft: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { color: colors.zinc700, flexShrink: 1 },
  error: { marginTop: 4 },
  input: { borderWidth: 0, flex: 1, height: 34, minWidth: 160, paddingHorizontal: spacing.xs },
  invalid: { borderColor: colors.danger },
  remove: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
});
