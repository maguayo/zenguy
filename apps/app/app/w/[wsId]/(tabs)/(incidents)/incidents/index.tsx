import { Feather } from "@expo/vector-icons";
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
import { formatDateTime, formatDuration } from "@/lib/format";
import { firstParam } from "@/lib/links";
import { largeTitleOptions } from "@/lib/stack-options";
import { colors, spacing } from "@/theme";
import {
  Badge,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Label,
  ListRow,
  LoadMore,
  Screen,
  SegmentedTabs,
  SelectSheet,
  Spinner,
} from "@/ui";

export default function IncidentsScreen() {
  const router = useRouter();
  const { current, timezone } = useWorkspace();
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
            <Label style={styles.typeLabel}>Type</Label>
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
            <Spinner label="Loading incidents" />
          ) : incidents.isError ? (
            <ErrorState onRetry={() => void incidents.refetch()} />
          ) : rows.length === 0 ? (
            status === "open" ? (
              <Card tone="ok">
                <EmptyState
                  description={openIncidentsDescription}
                  icon={<Feather color={colors.okDark} name="check-circle" size={26} />}
                  title="No open incidents"
                />
              </Card>
            ) : (
              <Card>
                <EmptyState title="No incidents found" />
              </Card>
            )
          ) : (
            <Card padding="none">
              {rows.map((incident, index) => {
                const resource = resourceTypePresentation(incident.resourceType);
                return (
                  <ListRow
                    key={incident.id}
                    right={
                      <View style={styles.right}>
                        <StatusBadge status={incident.status} />
                        <Caption>{formatDuration(liveIncidentDuration(incident, now))}</Caption>
                      </View>
                    }
                    style={index === rows.length - 1 ? styles.lastRow : undefined}
                    subtitle={
                      <View style={styles.subtitle}>
                        <Badge tone={resource.tone}>{resource.label}</Badge>
                        <Caption>Opened {formatDateTime(incident.openedAt, timezone)}</Caption>
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
  right: { alignItems: "flex-end", gap: spacing.xs },
  stack: { gap: spacing.lg },
  subtitle: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeLabel: { color: colors.zinc700 },
  typeRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  typeSelect: { flex: 1 },
});
