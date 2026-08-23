import { forwardRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { colors, controlHeight, fonts, radius, spacing } from "@/theme";

export interface InputProps extends TextInputProps {
  invalid?: boolean;
  /** Measured values (URLs, ids, tokens) are set in Geist Mono. */
  mono?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid = false, mono = false, multiline, onBlur, onFocus, style, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textSubtle}
      selectionColor={colors.accent}
      {...props}
      multiline={multiline}
      style={[
        styles.input,
        mono && styles.mono,
        multiline && styles.multiline,
        focused && styles.focused,
        invalid && styles.invalid,
        style,
      ]}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
    />
  );
});

export const PasswordInput = forwardRef<TextInput, InputProps>(function PasswordInput(
  { style, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.passwordWrap}>
      <Input
        ref={ref}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!visible}
        {...props}
        style={[styles.passwordInput, style]}
      />
      <Pressable
        accessibilityLabel={visible ? "Hide password" : "Show password"}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.eye}
        onPress={() => setVisible((value) => !value)}
      >
        <Feather color={colors.zinc600} name={visible ? "eye-off" : "eye"} size={18} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  eye: { alignItems: "center", height: controlHeight.md, justifyContent: "center", position: "absolute", right: 0, width: 46 },
  focused: { borderColor: colors.accent, borderWidth: 1.5 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.sans.regular,
    fontSize: 16,
    height: controlHeight.md,
    paddingHorizontal: 14,
  },
  invalid: { borderColor: colors.danger },
  mono: { fontFamily: fonts.mono.regular, fontSize: 14 },
  multiline: { height: undefined, lineHeight: 22, minHeight: 128, paddingTop: spacing.md, textAlignVertical: "top" },
  passwordInput: { paddingRight: 46 },
  passwordWrap: { justifyContent: "center" },
});
