import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, fonts, spacing } from "@/theme";
import { Display, Muted, Screen, Text } from "@/ui";

export function Wordmark({ dark = false, size = 24 }: { dark?: boolean; size?: number }) {
  return (
    <Text style={[styles.wordmark, { color: dark ? colors.onInk : colors.ink, fontSize: size, lineHeight: size * 1.2 }]}>
      zenguy
      <Text style={[styles.wordmark, { color: colors.accent, fontSize: size, lineHeight: size * 1.2 }]}>.</Text>
    </Text>
  );
}

/** Shared chrome for signed-out and account-access screens. */
export function AuthShell({
  children,
  description,
  footer,
  hasHeader = false,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  /** The native stack shows a header (back button): skip the extra top inset. */
  hasHeader?: boolean;
  title: string;
}) {
  return (
    <Screen keyboard safe={hasHeader ? ["bottom"] : ["top", "bottom"]}>
      <View style={[styles.brand, hasHeader && styles.brandUnderHeader]}>
        <Wordmark />
      </View>
      <View style={styles.header}>
        <Display>{title}</Display>
        {description ? (
          typeof description === "string" ? (
            <Muted style={styles.description}>{description}</Muted>
          ) : (
            <View style={styles.description}>{description}</View>
          )
        ) : null}
      </View>
      {children}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { marginBottom: spacing.xxxl, marginTop: spacing.lg },
  brandUnderHeader: { marginBottom: spacing.xxl, marginTop: spacing.xs },
  description: { fontSize: 16, lineHeight: 22, marginTop: spacing.sm },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
  },
  header: { marginBottom: spacing.xl },
  wordmark: { fontFamily: fonts.sans.bold, letterSpacing: -0.8 },
});
