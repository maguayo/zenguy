import { StatusBadge } from "@zenguy/frontend";

const row: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

export const RunStatuses = () => (
  <div style={row}>
    <StatusBadge status="QUEUED" />
    <StatusBadge status="RUNNING" />
    <StatusBadge status="PASSED" />
    <StatusBadge status="FAILED" />
    <StatusBadge status="TIMEOUT" />
  </div>
);

export const MonitorAndIncidentStatuses = () => (
  <div style={row}>
    <StatusBadge status="UP" />
    <StatusBadge status="DOWN" />
    <StatusBadge status="OPEN" />
    <StatusBadge status="RESOLVED" />
  </div>
);

export const SpecialCases = () => (
  <div style={row}>
    <StatusBadge passedAfterRetry status="PASSED" />
    <StatusBadge status="SYSTEM_ERROR" />
    <StatusBadge status="AMBIGUOUS" />
  </div>
);
