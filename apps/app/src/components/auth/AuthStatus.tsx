import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Wordmark } from "@/components/AuthShell";
import { colors, spacing, type Tone } from "@/theme";
import { Display, IconTile, Muted, Screen, type FeatherIconName } from "@/ui";

/**
 * Signed-out "status" screens (inbox checks, expired links, invitations):
 * the wordmark, a tinted tile that says what kind of moment this is, a
 * Display title and stacked full-width actions.
 */
export function AuthStatus({
  children,
  description,
  footer,
  icon,
  title,
  tone = "accent",
}: {
  children?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  icon: FeatherIconName;
  title: string;
  tone?: Tone;
}) {
  return (
    <Screen safe={["top", "bottom"]}>
      <View style={styles.brand}>
        <Wordmark />
      </View>
      <IconTile icon={icon} size={56} style={styles.tile} tone={tone} />
      <Display>{title}</Display>
      {description ? (
        typeof description === "string" ? (
          <Muted style={styles.description}>{description}</Muted>
        ) : (
          <View style={styles.description}>{description}</View>
        )
      ) : null}
      {children ? <View style={styles.body}>{children}</View> : null}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, marginTop: spacing.xl },
  brand: { marginBottom: spacing.xxxl, marginTop: spacing.lg },
  description: { fontSize: 16, lineHeight: 22, marginTop: spacing.sm },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
  },
  tile: { marginBottom: spacing.lg },
});
