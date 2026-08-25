import { Divider } from "@zenguy/frontend";

const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#18181b", margin: 0 };
const meta: React.CSSProperties = { fontSize: 13, color: "#52525b", margin: 0 };

export const BetweenSections = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
    <div>
      <p style={label}>Schedule</p>
      <p style={meta}>Every 30 minutes from eu-west</p>
    </div>
    <Divider />
    <div>
      <p style={label}>Notifications</p>
      <p style={meta}>Slack #alerts, email to ops@zenguy.com</p>
    </div>
    <Divider />
    <div>
      <p style={label}>Retries</p>
      <p style={meta}>Retry once after 30 seconds before opening an incident</p>
    </div>
  </div>
);

export const InSettingsList = () => (
  <div style={{ maxWidth: 420, border: "1px solid #e4e4e7", borderRadius: 8, background: "#fff", padding: 16 }}>
    <p style={label}>Workspace members</p>
    <p style={meta}>3 of 5 seats used</p>
    <Divider style={{ marginTop: 12, marginBottom: 12 }} />
    <p style={label}>API tokens</p>
    <p style={meta}>2 active tokens, last used 4 hours ago</p>
  </div>
);
