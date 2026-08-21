import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, spacing } from "@/theme";
import { Muted, Screen, Text, Title } from "@/ui";

export function Wordmark({ dark = false, size = 22 }: { dark?: boolean; size?: number }) {
  return (
    <Text style={[styles.wordmark, { color: dark ? colors.white : colors.zinc950, fontSize: size }]}>
      zenguy
      <Text style={[styles.wordmark, { color: "#818cf8", fontSize: size }]}>.</Text>
    </Text>
  );
}

/** Shared chrome for the signed-out and onboarding screens. */
export function AuthShell({
  children,
  description,
  footer,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  title: string;
}) {
  return (
    <Screen keyboard safe={["top", "bottom"]}>
      <View style={styles.brand}>
        <Wordmark />
      </View>
      <View style={styles.header}>
        <Title>{title}</Title>
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
  brand: { marginBottom: spacing.xxl, marginTop: spacing.md },
  description: { marginTop: spacing.sm },
  footer: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.xxl, paddingTop: spacing.lg },
  header: { marginBottom: spacing.xl },
  wordmark: { fontWeight: "700", letterSpacing: -0.5 },
});
