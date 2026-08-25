import { RunSourceBadge } from "@zenguy/frontend";

const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

export const AllSources = () => (
  <div style={row}>
    <RunSourceBadge source="MANUAL" />
    <RunSourceBadge source="SCHEDULED" />
    <RunSourceBadge source="VALIDATION" />
  </div>
);

export const InRunRow = () => (
  <div style={{ ...row, fontSize: 14, color: "#3f3f46" }}>
    <span style={{ fontWeight: 500, color: "#18181b" }}>Checkout flow</span>
    <RunSourceBadge source="MANUAL" />
    <span style={{ color: "#71717a" }}>38.2s · 2 minutes ago</span>
  </div>
);
