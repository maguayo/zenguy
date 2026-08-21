import { StyleSheet, View } from "react-native";

import { spacing } from "@/theme";
import { Button } from "./Button";

export function LoadMore({
  loading,
  nextCursor,
  onMore,
}: {
  loading: boolean;
  nextCursor: string | null;
  onMore: () => void;
}) {
  if (!nextCursor && !loading) return null;
  return (
    <View style={styles.wrap}>
      <Button loading={loading} title="Load more" onPress={onMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: spacing.md },
});
