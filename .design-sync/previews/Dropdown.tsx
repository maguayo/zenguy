import { useEffect, useRef } from "react";
import { Button, Dropdown } from "@zenguy/frontend";

const noop = () => undefined;

const monitorActions = [
  { label: "Run now", description: "Trigger a manual check", onSelect: noop },
  { label: "Pause monitor", onSelect: noop },
  { label: "Duplicate", onSelect: noop },
  { label: "View incidents", onSelect: noop },
  {
    label: "Delete monitor",
    onSelect: noop,
    separatorBefore: true,
    tone: "danger" as const,
  },
];

/**
 * Dropdown keeps its open state internally (no controlled prop), so the
 * canonical open story clicks the trigger once on mount.
 */
export const MonitorActionsOpen = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.click();
  }, []);
  return (
    <div ref={ref} style={{ padding: "16px 16px 300px" }}>
      <Dropdown
        align="start"
        items={monitorActions}
        trigger={<Button>Actions</Button>}
      />
    </div>
  );
};

export const TriggerClosed = () => (
  <div style={{ padding: 16 }}>
    <Dropdown
      align="start"
      items={monitorActions}
      trigger={<Button>Actions</Button>}
    />
  </div>
);
