import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Pressable, StyleSheet } from "react-native";

import { colors } from "@/theme";

export function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      accessibilityLabel={copied ? "Copied" : label}
      accessibilityRole="button"
      hitSlop={8}
      style={styles.button}
      onPress={() => {
        void Clipboard.setStringAsync(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      <Feather color={copied ? colors.okDark : colors.zinc600} name={copied ? "check" : "copy"} size={15} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: "center", height: 28, justifyContent: "center", width: 28 },
});
