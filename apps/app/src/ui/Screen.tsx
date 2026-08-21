import type { ReactNode, Ref } from "react";
import {
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, spacing } from "@/theme";

interface Props {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Wraps the content so the keyboard never covers focused inputs. */
  keyboard?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  refreshing?: boolean;
  /** Safe-area edges to respect; headers/tab bars handle top/bottom by default. */
  safe?: Edge[];
  scroll?: boolean;
  /** Access to the underlying ScrollView (for programmatic scrolling). */
  scrollRef?: Ref<ScrollView>;
}

export function Screen({
  children,
  contentContainerStyle,
  keyboard = false,
  onRefresh,
  padded = true,
  refreshing = false,
  safe = [],
  scroll = true,
  scrollRef,
}: Props) {
  const content = scroll ? (
    <ScrollView
      ref={scrollRef}
      alwaysBounceVertical
      contentContainerStyle={[padded && styles.padded, styles.grow, contentContainerStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} tintColor={colors.zinc500} onRefresh={onRefresh} />
        ) : undefined
      }
      style={styles.flex}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, contentContainerStyle]}>{children}</View>
  );

  const body = keyboard ? (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={64} style={styles.flex}>
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return (
    <SafeAreaView edges={safe} style={styles.root}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { padding: spacing.lg, paddingBottom: spacing.xxl },
  root: { backgroundColor: colors.bg, flex: 1 },
});
