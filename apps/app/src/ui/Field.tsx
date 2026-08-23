import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing } from "@/theme";
import { Caption, Label } from "./Text";

interface Props {
  children: ReactNode;
  error?: string;
  hint?: string;
  label: string;
  required?: boolean;
}

export function Field({ children, error, hint, label, required = false }: Props) {
  return (
    <View style={styles.field}>
      <Label color={colors.textBody} style={styles.label}>
        {label}
        {required ? <Label color={colors.danger}> *</Label> : null}
      </Label>
      {children}
      {error ? (
        <Caption accessibilityRole="alert" color={colors.dangerDark} style={styles.note}>
          {error}
        </Caption>
      ) : hint ? (
        <Caption style={styles.note}>{hint}</Caption>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs + 2 },
  label: { marginBottom: 1 },
  note: { marginTop: 2 },
});
