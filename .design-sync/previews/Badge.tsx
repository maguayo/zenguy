import { Badge } from "@zenguy/frontend";

const row: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

export const MonitorStatus = () => (
  <div style={row}>
    <span style={{ fontSize: 14, fontWeight: 500 }}>api.zenguy.com</span>
    <Badge tone="ok">Up</Badge>
    <span style={{ fontSize: 12, color: "#71717a" }}>checked 30s ago</span>
  </div>
);

export const Tones = () => (
  <div style={row}>
    <Badge tone="ok">Passing</Badge>
    <Badge tone="danger">Down</Badge>
    <Badge tone="warn">Degraded</Badge>
    <Badge tone="info">Scheduled</Badge>
    <Badge tone="neutral">Paused</Badge>
    <Badge tone="accent">Beta</Badge>
  </div>
);

export const Counts = () => (
  <div style={row}>
    <Badge tone="danger">2 open incidents</Badge>
    <Badge tone="info">12 monitors</Badge>
    <Badge tone="neutral">Free plan</Badge>
  </div>
);
