import { Link } from "expo-router";
import type { ReactNode } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { colors, spacing } from "@/theme";
import { Body, Caption, Heading, Label, Screen, Title } from "@/ui";

export const legalEffectiveDate = "Effective and last updated: August 21, 2026";
export const legalContactEmail = "privacy@zenguy.com";

/** Mirrors the web LegalLayout: title, effective date, sections, related link. */
export function LegalPage({
  children,
  related,
  title,
}: {
  children: ReactNode;
  related: { href: "/privacy" | "/terms"; label: string };
  title: string;
}) {
  return (
    <Screen>
      <Title>{title}</Title>
      <Caption style={styles.date}>{legalEffectiveDate}</Caption>
      <View style={styles.sections}>{children}</View>
      <View style={styles.footer}>
        <Link href={related.href}>
          <Label color={colors.accentDark}>{related.label}</Label>
        </Link>
      </View>
    </Screen>
  );
}

export function LegalSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Heading>{title}</Heading>
      {children}
    </View>
  );
}

export function LegalParagraph({ children }: { children: ReactNode }) {
  return <Body style={styles.paragraph}>{children}</Body>;
}

export function LegalContactEmail() {
  return (
    <Body
      accessibilityRole="link"
      color={colors.accentDark}
      onPress={() => {
        void Linking.openURL(`mailto:${legalContactEmail}`).catch(() => undefined);
      }}
    >
      {legalContactEmail}
    </Body>
  );
}

const styles = StyleSheet.create({
  date: { marginTop: spacing.sm },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
  },
  paragraph: { color: colors.zinc700, lineHeight: 23 },
  section: { gap: spacing.sm },
  sections: { gap: spacing.xl, marginTop: spacing.xl },
});
