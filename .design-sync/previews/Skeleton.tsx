import { Skeleton } from "@zenguy/frontend";

export const TextLines = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
    <Skeleton style={{ height: 16, width: "60%" }} />
    <Skeleton style={{ height: 12, width: "100%" }} />
    <Skeleton style={{ height: 12, width: "85%" }} />
  </div>
);

export const MonitorCardLoading = () => (
  <div style={{ maxWidth: 360, border: "1px solid #e4e4e7", borderRadius: 8, background: "#fff", padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <Skeleton style={{ height: 32, width: 32, borderRadius: 9999 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <Skeleton style={{ height: 14, width: "50%" }} />
        <Skeleton style={{ height: 10, width: "30%" }} />
      </div>
      <Skeleton style={{ height: 20, width: 56, borderRadius: 9999 }} />
    </div>
    <Skeleton style={{ height: 48, width: "100%" }} />
  </div>
);

export const StatBlocks = () => (
  <div style={{ display: "flex", gap: 12 }}>
    <Skeleton style={{ height: 64, width: 120 }} />
    <Skeleton style={{ height: 64, width: 120 }} />
    <Skeleton style={{ height: 64, width: 120 }} />
  </div>
);
