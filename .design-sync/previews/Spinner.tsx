import { Spinner } from "@zenguy/frontend";

const row: React.CSSProperties = { display: "flex", gap: 16, alignItems: "center" };

export const RunInProgress = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#52525b" }}>
    <Spinner label="Run in progress" />
    <span>Running “Checkout flow” — step 3 of 7</span>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Spinner label="Loading, small" size={4} />
    <Spinner label="Loading, medium" size={5} />
    <Spinner label="Loading, large" size={6} />
  </div>
);

export const AccentColored = () => (
  <div style={row}>
    <Spinner className="text-accent-600" label="Deploying runner" size={6} />
    <span style={{ fontSize: 13, color: "#52525b" }}>Provisioning browser runner…</span>
  </div>
);
