import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";

import { getMonitor } from "@/api/uptime";
import { uptimeHref } from "@/components/uptime/links";
import { MonitorForm } from "@/components/uptime/MonitorForm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { itemQueryErrorMessage } from "@/lib/errors";
import { firstParam } from "@/lib/links";
import { ErrorState, Screen, Spinner } from "@/ui";

export default function EditMonitorScreen() {
  const params = useLocalSearchParams<{ monitorId: string }>();
  const monitorId = firstParam(params.monitorId) ?? "";
  const { can, current } = useWorkspace();
  const allowed = can("uptime.manage");
  const monitor = useQuery({
    enabled: allowed,
    queryFn: () => getMonitor(current.id, monitorId),
    queryKey: ["ws", current.id, "monitors", monitorId],
  });

  if (!allowed) return <Redirect href={uptimeHref(current.id)} />;

  return (
    <>
      <Stack.Screen options={{ title: "Edit monitor" }} />
      <Screen keyboard>
        {monitor.isPending ? (
          <Spinner label="Loading uptime monitor" />
        ) : monitor.isError ? (
          <ErrorState
            message={itemQueryErrorMessage(monitor.error)}
            onRetry={() => void monitor.refetch()}
          />
        ) : (
          <MonitorForm key={monitor.data.id} monitor={monitor.data} />
        )}
      </Screen>
    </>
  );
}
