import type { ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing } from "@/theme";
import { useReveal } from "./motion";
import { Display, Eyebrow, Small } from "./Text";

interface Props {
  children?: ReactNode;
  eyebrow?: string;
  /** Plays the one orchestrated entrance (fade + rise). */
  reveal?: boolean;
  style?: StyleProp<ViewStyle>;
  subtitle?: string;
  title: string;
}

/** The only dark element in the app: an ink card on paper. */
export function Hero({ children, eyebrow, reveal = true, style, subtitle, title }: Props) {
  const { opacity, translateY } = useReveal(reveal);
  return (
    <Animated.View style={[styles.shadow, { opacity, transform: [{ translateY }] }, style]}>
      <View style={styles.card}>
        {eyebrow ? (
          <Eyebrow color={colors.onInkSubtle} style={styles.eyebrow}>
            {eyebrow}
          </Eyebrow>
        ) : null}
        <Display color={colors.onInk}>{title}</Display>
        {subtitle ? (
          <Small color={colors.onInkMuted} style={styles.subtitle}>
            {subtitle}
          </Small>
        ) : null}
        {children ? <View style={styles.body}>{children}</View> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: spacing.lg },
  card: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: spacing.xl },
  eyebrow: { marginBottom: spacing.md },
  shadow: { borderRadius: radius.xl, ...shadows.hero },
  subtitle: { marginTop: spacing.sm },
});
