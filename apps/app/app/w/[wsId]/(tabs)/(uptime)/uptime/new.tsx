import { Redirect, Stack } from "expo-router";

import { uptimeHref } from "@/components/uptime/links";
import { MonitorForm } from "@/components/uptime/MonitorForm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Screen } from "@/ui";

export default function NewMonitorScreen() {
  const { can, current } = useWorkspace();

  if (!can("uptime.manage")) return <Redirect href={uptimeHref(current.id)} />;

  return (
    <>
      <Stack.Screen options={{ title: "New monitor" }} />
      <Screen keyboard>
        <MonitorForm />
      </Screen>
    </>
  );
}
