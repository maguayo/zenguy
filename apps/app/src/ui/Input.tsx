import { forwardRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { colors, controlHeight, radius, spacing, typography } from "@/theme";

export interface InputProps extends TextInputProps {
  invalid?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid = false, multiline, style, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.zinc400}
      selectionColor={colors.accent}
      {...props}
      multiline={multiline}
      style={[styles.input, multiline && styles.multiline, invalid && styles.invalid, style]}
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
        <Feather color={colors.zinc500} name={visible ? "eye-off" : "eye"} size={18} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  eye: { alignItems: "center", height: controlHeight.md, justifyContent: "center", position: "absolute", right: 0, width: 44 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.zinc300,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    height: controlHeight.md,
    paddingHorizontal: spacing.md,
    ...typography.body,
    lineHeight: undefined,
  },
  invalid: { borderColor: colors.danger },
  multiline: { height: undefined, minHeight: 120, paddingTop: spacing.md, textAlignVertical: "top" },
  passwordInput: { paddingRight: 44 },
  passwordWrap: { justifyContent: "center" },
});
