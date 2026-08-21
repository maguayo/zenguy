import { forwardRef, useImperativeHandle, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, spacing, typography } from "@/theme";
import { Caption, Input, Mono } from "@/ui";

import { MAX_ALLOWED_DOMAINS, addDomains, isAllowedDomain, removeDomain } from "./domains";

export { addDomains, isAllowedDomain };

export interface DomainListInputHandle {
  /**
   * Commits whatever is still typed in the field. Returns false (and shows the
   * reason) when the pending text is not a valid domain, so a submit can stop.
   */
  flush: () => boolean;
}

interface Props {
  accessibilityLabel?: string;
  invalid?: boolean;
  max?: number;
  onChange: (domains: string[]) => void;
  value: string[];
}

/**
 * Chip list of allowed domains. Return, a comma, or leaving the field commits
 * the draft; Backspace on an empty draft removes the last chip, like the web.
 */
export const DomainListInput = forwardRef<DomainListInputHandle, Props>(function DomainListInput(
  { accessibilityLabel = "Allowed domains", invalid = false, max = MAX_ALLOWED_DOMAINS, onChange, value },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const commit = (input: string): boolean => {
    const result = addDomains(value, input, max);
    setLocalError(result.error);
    if (result.error) {
      setDraft(input);
      return false;
    }
    if (result.domains !== value) onChange(result.domains);
    setDraft("");
    return true;
  };

  useImperativeHandle(ref, () => ({ flush: () => (draft.trim() ? commit(draft) : true) }));

  return (
    <View style={styles.wrap}>
      {value.length > 0 ? (
        <View style={styles.chips}>
          {value.map((domain) => (
            <View key={domain} style={styles.chip}>
              <Mono color={colors.zinc700} numberOfLines={1} style={styles.chipText}>
                {domain}
              </Mono>
              <Pressable
                accessibilityLabel={`Remove ${domain}`}
                accessibilityRole="button"
                hitSlop={6}
                style={({ pressed }) => [styles.chipRemove, pressed && styles.chipRemovePressed]}
                onPress={() => onChange(removeDomain(value, domain))}
              >
                <Feather color={colors.zinc500} name="x" size={12} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Input
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        inputMode="url"
        invalid={invalid || Boolean(localError)}
        keyboardType="url"
        placeholder={value.length === 0 ? "example.com" : "Add another domain"}
        returnKeyType="done"
        spellCheck={false}
        style={styles.input}
        submitBehavior="submit"
        textContentType="URL"
        value={draft}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        onChangeText={(text) => {
          setLocalError(null);
          if (text.endsWith(",")) {
            commit(text.slice(0, -1));
            return;
          }
          setDraft(text);
        }}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Backspace" && draft.length === 0 && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onSubmitEditing={() => commit(draft)}
      />
      {localError ? (
        <Caption accessibilityRole="alert" color={colors.danger}>
          {localError}
        </Caption>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 2,
    maxWidth: "100%",
    paddingLeft: spacing.sm,
    paddingRight: 2,
    paddingVertical: 2,
  },
  chipRemove: { alignItems: "center", borderRadius: radius.sm, height: 24, justifyContent: "center", width: 24 },
  chipRemovePressed: { backgroundColor: colors.zinc200 },
  chipText: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  input: { fontFamily: typography.mono.fontFamily },
  wrap: { gap: spacing.sm },
});
