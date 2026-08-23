import { useInfiniteQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { listIncidents } from "@/api/incidents";
import type { Incident } from "@/api/types";
import {
  hasOpenIncident,
  incidentFilters,
  incidentStatusTabs,
  incidentTypeOptions,
  liveIncidentDuration,
  openIncidentsDescription,
  parseIncidentStatus,
  parseIncidentType,
  resourceTypePresentation,
  type IncidentStatusTab,
  type IncidentTypeFilter,
} from "@/components/incidents/incidents-list";
import { useNow } from "@/components/incidents/use-now";
import { StatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { ApiPage } from "@/lib/api";
import { formatDuration, formatRelative } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, radius, spacing } from "@/theme";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  Label,
  ListRow,
  LoadMore,
  Screen,
  SegmentedTabs,
  SelectSheet,
  Skeleton,
} from "@/ui";

/** "browser test · opened 12 min ago · 6m 41s" — the measured line under each row. */
export function incidentMetaLine(incident: Incident, durationMs: number): string {
  const resource = resourceTypePresentation(incident.resourceType);
  return `${resource.label.toLowerCase()} · opened ${formatRelative(incident.openedAt)} · ${formatDuration(durationMs)}`;
}

function ListSkeleton() {
  return (
    <Card padding="none">
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.skeletonRow, index === 2 && styles.lastRow]}>
          <Skeleton height={36} style={styles.skeletonTile} width={36} />
          <View style={styles.skeletonText}>
            <Skeleton width={170} />
            <Skeleton height={12} width={220} />
          </View>
        </View>
      ))}
    </Card>
  );
}

export default function IncidentsScreen() {
  const router = useRouter();
  const { current } = useWorkspace();
  const params = useLocalSearchParams<{ status?: string; type?: string }>();
  const statusParam = firstParam(params.status);
  const typeParam = firstParam(params.type);
  const [status, setStatus] = useState<IncidentStatusTab>(() => parseIncidentStatus(statusParam));
  const [type, setType] = useState<IncidentTypeFilter>(() => parseIncidentType(typeParam));
  // Filters live in local state; a deep link (Overview → "Open incidents") that
  // lands on an already-mounted screen re-seeds them from the new params.
  const [seenParams, setSeenParams] = useState({ status: statusParam, type: typeParam });
  if (seenParams.status !== statusParam || seenParams.type !== typeParam) {
    setSeenParams({ status: statusParam, type: typeParam });
    setStatus(parseIncidentStatus(statusParam));
    setType(parseIncidentType(typeParam));
  }

  const filters = incidentFilters(status, type);
  const incidents = useInfiniteQuery<ApiPage<Incident>>({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listIncidents(current.id, filters, pageParam as string | null),
    queryKey: ["ws", current.id, "incidents", filters],
    refetchInterval: status === "open" ? 30_000 : false,
  });
  const rows = incidents.data?.pages.flatMap((page) => page.items) ?? [];
  const now = useNow(hasOpenIncident(rows));
  const nextCursor = incidents.hasNextPage
    ? (incidents.data?.pages.at(-1)?.nextCursor ?? null)
    : null;

  return (
    <>
      <Stack.Screen options={{ ...largeTitleOptions, title: "Incidents" }} />
      <Screen
        refreshing={incidents.isRefetching && !incidents.isPending && !incidents.isFetchingNextPage}
        onRefresh={() => void incidents.refetch()}
      >
        <View style={styles.stack}>
          <SegmentedTabs items={incidentStatusTabs} value={status} onChange={setStatus} />
          <View style={styles.typeRow}>
            <Label color={colors.textBody} style={styles.typeLabel}>
              Type
            </Label>
            <View style={styles.typeSelect}>
              <SelectSheet
                accessibilityLabel="Type"
                options={incidentTypeOptions}
                title="Type"
                value={type}
                onChange={setType}
              />
            </View>
          </View>

          {incidents.isPending ? (
            <ListSkeleton />
          ) : incidents.isError ? (
            <ErrorState onRetry={() => void incidents.refetch()} />
          ) : rows.length === 0 ? (
            status === "open" ? (
              <Card elevated>
                <EmptyState
                  description={openIncidentsDescription}
                  icon={<IconTile icon="check" size={44} tone="ok" />}
                  title="All clear."
                />
              </Card>
            ) : (
              <Card>
                <EmptyState icon={<IconTile icon="inbox" size={44} />} title="No incidents found" />
              </Card>
            )
          ) : (
            <Card
              eyebrow={`${rows.length} ${rows.length === 1 ? "incident" : "incidents"}${nextCursor ? " loaded" : ""}`}
              padding="none"
            >
              {rows.map((incident, index) => {
                const resource = resourceTypePresentation(incident.resourceType);
                const open = incident.status === "OPEN";
                return (
                  <ListRow
                    key={incident.id}
                    left={<IconTile icon={open ? "alert-octagon" : "check"} tone={open ? "danger" : "ok"} />}
                    meta={incidentMetaLine(incident, liveIncidentDuration(incident, now))}
                    style={index === rows.length - 1 ? styles.lastRow : undefined}
                    subtitle={
                      <View style={styles.subtitle}>
                        <StatusBadge status={incident.status} />
                        <Badge tone={resource.tone}>{resource.label}</Badge>
                      </View>
                    }
                    title={incident.resourceName}
                    onPress={() =>
                      router.push(`/w/${current.id}/incidents/${incident.id}` as Href)
                    }
                  />
                );
              })}
            </Card>
          )}

          <LoadMore
            loading={incidents.isFetchingNextPage}
            nextCursor={nextCursor}
            onMore={() => void incidents.fetchNextPage()}
          />
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  lastRow: { borderBottomWidth: 0 },
  skeletonRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
  },
  skeletonText: { flex: 1, gap: spacing.sm },
  skeletonTile: { borderRadius: radius.md },
  stack: { gap: spacing.lg },
  subtitle: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeLabel: { width: 40 },
  typeRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  typeSelect: { flex: 1 },
});
