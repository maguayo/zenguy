import { Checkbox } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 };
const row: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: "#3f3f46" };

export const WithLabels = () => (
  <div style={col}>
    <label style={row}>
      <Checkbox defaultChecked /> Alert me when a run fails
    </label>
    <label style={row}>
      <Checkbox /> Include response body in failure reports
    </label>
    <label style={row}>
      <Checkbox defaultChecked /> Notify #ops-alerts on Slack
    </label>
  </div>
);

export const States = () => (
  <div style={col}>
    <label style={row}>
      <Checkbox invalid /> Accept the terms of service
    </label>
    <label style={{ ...row, opacity: 1 }}>
      <Checkbox disabled /> Retry failed checks automatically (plan upgrade required)
    </label>
    <label style={row}>
      <Checkbox defaultChecked disabled /> Uptime monitoring enabled by workspace policy
    </label>
  </div>
);
