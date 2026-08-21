import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { getBillingConfig } from "@/api/billing";
import { pastDueBanner } from "@/components/more/billing";
import { toHref } from "@/components/more/links";
import { visibleMoreItems, type FeatherName } from "@/components/more/menu";
import { RoleBadge } from "@/components/RoleBadge";
import { rememberWorkspace, useWorkspace } from "@/contexts/WorkspaceContext";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, radius, spacing } from "@/theme";
import { Caption, Card, Label, ListRow, Screen, SelectSheet, Small } from "@/ui";

function MenuIcon({ name }: { name: FeatherName }) {
  return (
    <View style={styles.icon}>
      <Feather color={colors.zinc600} name={name} size={18} />
    </View>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, current, role, subscriptionStatus, workspaces } = useWorkspace();
  const billingConfig = useQuery({ queryFn: getBillingConfig, queryKey: ["billing-config"] });
  const base = `/w/${current.id}`;
  const banner = pastDueBanner(subscriptionStatus, can("billing.manage"));
  const items = visibleMoreItems(can);
  const showComplimentary = billingConfig.data?.canIssueComplimentaryGrants === true;
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
    void billingConfig.refetch();
    void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  };

  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "More" }} />
      <Screen refreshing={billingConfig.isRefetching && !billingConfig.isPending} onRefresh={refresh}>
        <View style={styles.stack}>
          {banner ? (
            <Card tone="warn">
              <Small>{banner.message}</Small>
              <Label style={styles.bannerAction}>{banner.action}</Label>
            </Card>
          ) : null}

          <Card padding="none">
            <View style={styles.workspace}>
              <View style={styles.workspaceHeader}>
                <Caption>Workspace</Caption>
                <RoleBadge role={role} />
              </View>
              <SelectSheet
                accessibilityLabel={`Switch workspace. Current workspace: ${current.name}`}
                options={workspaceOptions}
                title="Switch workspace"
                value={current.id}
                onChange={(workspaceId) => void switchWorkspace(workspaceId)}
              />
            </View>
            <ListRow
              left={<MenuIcon name="plus" />}
              style={styles.lastRow}
              title="Create workspace"
              onPress={() => router.push("/onboarding/workspace")}
            />
          </Card>

          <Card padding="none">
            {items.map((item, index) => (
              <ListRow
                key={item.path}
                left={<MenuIcon name={item.icon} />}
                style={index === items.length - 1 ? styles.lastRow : undefined}
                title={item.label}
                onPress={() => router.push(toHref(`${base}/${item.path}`))}
              />
            ))}
          </Card>

          <Card padding="none">
            <ListRow
              left={<MenuIcon name="user" />}
              style={showComplimentary ? undefined : styles.lastRow}
              title="Account"
              onPress={() => router.push(toHref(`${base}/account`))}
            />
            {showComplimentary ? (
              <ListRow
                left={<MenuIcon name="gift" />}
                style={styles.lastRow}
                title="Complimentary links"
                onPress={() => router.push(toHref("/complimentary"))}
              />
            ) : null}
          </Card>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  bannerAction: { marginTop: spacing.xs },
  icon: {
    alignItems: "center",
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  lastRow: { borderBottomWidth: 0 },
  stack: { gap: spacing.lg },
  workspace: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  workspaceHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
});
