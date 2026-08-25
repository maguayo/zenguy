import { CopyButton } from "@zenguy/frontend";

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  color: "#3f3f46",
  background: "#f4f4f5",
  borderRadius: 6,
  padding: "4px 8px",
};

export const CopyApiToken = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <code style={mono}>zg_live_4f8a…c21d</code>
    <CopyButton label="Copy API token" text="zg_live_4f8a9b2e771c3d05c21d" />
  </div>
);

export const CopyRunUrl = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <span style={{ fontSize: 13, color: "#52525b" }}>Run #4,812 — Checkout flow</span>
    <CopyButton label="Copy run URL" text="https://app.zenguy.com/runs/run_9f3k2m" />
  </div>
);
