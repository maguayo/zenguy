import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { absoluteArtifactUrl } from "@/lib/api";
import { colors, palette, radius, spacing } from "@/theme";
import { Body, Heading, MonoSmall, Small } from "@/ui";
import { clampScreenshotIndex, nextScreenshotIndex, type ScreenshotItem } from "./screenshots";

export { nextScreenshotIndex, type ScreenshotItem } from "./screenshots";

function NavButton({
  disabled,
  label,
  name,
  onPress,
  side,
}: {
  disabled: boolean;
  label: string;
  name: "chevron-left" | "chevron-right";
  onPress: () => void;
  side: "left" | "right";
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.navButton,
        side === "left" ? styles.navLeft : styles.navRight,
        pressed && styles.pressed,
        disabled && styles.navDisabled,
      ]}
      onPress={onPress}
    >
      <Feather color={colors.onInk} name={name} size={22} />
    </Pressable>
  );
}

/** Full-screen evidence viewer with previous/next navigation. */
export function ScreenshotViewer({
  initialIndex,
  onClose,
  open,
  screenshots,
}: {
  initialIndex: number;
  onClose: () => void;
  open: boolean;
  screenshots: ScreenshotItem[];
}) {
  const count = screenshots.length;
  const [index, setIndex] = useState(() => clampScreenshotIndex(initialIndex, count));
  const [expired, setExpired] = useState(false);
  // Re-derive the starting index each time the viewer opens on a new screenshot.
  const openingKey = open ? `${initialIndex}:${count}` : null;
  const [seenOpeningKey, setSeenOpeningKey] = useState(openingKey);
  if (openingKey !== seenOpeningKey) {
    setSeenOpeningKey(openingKey);
    if (openingKey !== null) {
      setIndex(clampScreenshotIndex(initialIndex, count));
      setExpired(false);
    }
  }
  const goTo = (direction: -1 | 1) => {
    setIndex((current) => nextScreenshotIndex(current, count, direction));
    setExpired(false);
  };

  const screenshot = screenshots[index];

  return (
    <Modal animationType="fade" presentationStyle="fullScreen" visible={open} onRequestClose={onClose}>
      <StatusBar style="light" />
      <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
        <View style={styles.header}>
          <Heading color={colors.onInk}>Screenshot evidence</Heading>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            onPress={onClose}
          >
            <Feather color={colors.onInkMuted} name="x" size={22} />
          </Pressable>
        </View>
        <View style={styles.stage}>
          {screenshot && !expired ? (
            <Image
              accessibilityLabel={`Screenshot ${index + 1}`}
              contentFit="contain"
              source={{ uri: absoluteArtifactUrl(screenshot.url) }}
              style={styles.image}
              transition={120}
              onError={() => setExpired(true)}
            />
          ) : (
            <View style={styles.fallback}>
              <Feather color={colors.onInkSubtle} name="image" size={40} />
              <Body color={colors.onInkMuted}>Screenshot expired</Body>
            </View>
          )}
          <NavButton
            disabled={index <= 0}
            label="Previous screenshot"
            name="chevron-left"
            side="left"
            onPress={() => goTo(-1)}
          />
          <NavButton
            disabled={index >= count - 1}
            label="Next screenshot"
            name="chevron-right"
            side="right"
            onPress={() => goTo(1)}
          />
        </View>
        <View style={styles.footer}>
          <MonoSmall color={colors.onInkMuted} style={styles.centered}>
            {count === 0 ? 0 : index + 1} of {count}
          </MonoSmall>
          {screenshot?.caption ? (
            <Small color={colors.onInkMuted} numberOfLines={2} style={styles.centered}>
              {screenshot.caption}
            </Small>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centered: { textAlign: "center" },
  close: { alignItems: "center", borderRadius: radius.md, height: 36, justifyContent: "center", width: 36 },
  fallback: { alignItems: "center", gap: spacing.md, justifyContent: "center" },
  footer: {
    borderTopColor: palette.inkCard,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  header: {
    alignItems: "center",
    borderBottomColor: palette.inkCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  image: { borderRadius: radius.md, height: "100%", width: "100%" },
  navButton: {
    alignItems: "center",
    backgroundColor: "rgba(19, 17, 13, 0.72)",
    borderRadius: radius.full,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    top: "50%",
    width: 44,
  },
  navDisabled: { opacity: 0.3 },
  navLeft: { left: spacing.md },
  navRight: { right: spacing.md },
  pressed: { backgroundColor: palette.inkCard },
  root: { backgroundColor: palette.inkDeep, flex: 1 },
  stage: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing.lg },
});
