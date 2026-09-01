import { useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { toHref } from "@/components/more/links";
import { visibleMoreItems } from "@/components/more/menu";
import { RoleBadge } from "@/components/RoleBadge";
import { rememberWorkspace, useWorkspace } from "@/contexts/WorkspaceContext";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, spacing } from "@/theme";
import { Card, Heading, IconTile, ListRow, Screen, SelectSheet, Text } from "@/ui";

export function workspaceInitial(name: string): string {
  return (name.trim().slice(0, 1) || "W").toUpperCase();
}

export default function MoreScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, current, role, workspaces } = useWorkspace();
  const base = `/w/${current.id}`;
  const items = visibleMoreItems(can);
  const workspaceOptions = workspaces.map((workspace) => ({
    description: workspace.role.charAt(0) + workspace.role.slice(1).toLowerCase(),
    label: workspace.name,
    value: workspace.id,
  }));

  const switchWorkspace = async (workspaceId: string) => {
    if (workspaceId === current.id) return;
    try {
      await rememberWorkspace(workspaceId);
    } catch {
      // The workspace provider remembers it again once the new workspace loads.
    }
    router.replace(`/w/${workspaceId}/overview`);
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };

  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "More" }} />
      <Screen onRefresh={refresh}>
        <View style={styles.stack}>
          <Card elevated padding="none">
            <View style={styles.workspace}>
              <View style={styles.workspaceHeader}>
                <IconTile ink size={44}>
                  <Text color={colors.onInk} style={styles.initial}>
                    {workspaceInitial(current.name)}
                  </Text>
                </IconTile>
                <View style={styles.workspaceText}>
                  <Heading numberOfLines={1}>{current.name}</Heading>
                  <RoleBadge role={role} />
                </View>
              </View>
              <SelectSheet
                accessibilityLabel={`Switch workspace. Current workspace: ${current.name}`}
                options={workspaceOptions}
                title="Switch workspace"
                value={current.id}
                onChange={(workspaceId) => void switchWorkspace(workspaceId)}
              />
            </View>
          </Card>

          <Card eyebrow="Workspace" padding="none">
            {items.map((item, index) => (
              <ListRow
                key={item.path}
                left={<IconTile icon={item.icon} size={32} />}
                style={index === items.length - 1 ? styles.lastRow : undefined}
                title={item.label}
                onPress={() => router.push(toHref(`${base}/${item.path}`))}
              />
            ))}
          </Card>

          <Card eyebrow="You" padding="none">
            <ListRow
              left={<IconTile icon="user" size={32} />}
              style={styles.lastRow}
              testID="more-account"
              title="Account"
              onPress={() => router.push(toHref(`${base}/account`))}
            />
          </Card>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  initial: { fontSize: 18, fontWeight: "600", lineHeight: 22 },
  lastRow: { borderBottomWidth: 0 },
  stack: { gap: spacing.xl },
  workspace: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.lg,
  },
  workspaceHeader: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  workspaceText: { alignItems: "flex-start", flex: 1, gap: spacing.xs + 2 },
});
