import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs } from "../../components/ui/Tabs";
import { useWorkspace } from "../../contexts/WorkspaceContext";

export type AlertsTab = "channels" | "sms-calls";

export const alertsTabs: { key: AlertsTab; label: string }[] = [
  { key: "channels", label: "Channels" },
  { key: "sms-calls", label: "SMS & calls" },
];

export function alertsTabPath(workspaceId: string, tab: AlertsTab): string {
  const base = `/w/${workspaceId}/alerts`;
  return tab === "channels" ? base : `${base}/sms-calls`;
}

export function AlertsTabs({
  actions,
  active,
  description,
}: {
  actions?: ReactNode;
  active: AlertsTab;
  description?: ReactNode;
}) {
  const { current } = useWorkspace();
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <PageHeader actions={actions} description={description} title="Alerts" />
      <Tabs
        items={alertsTabs}
        label="Alert sections"
        value={active}
        onChange={(key) => navigate(alertsTabPath(current.id, key as AlertsTab))}
      />
    </div>
  );
}
