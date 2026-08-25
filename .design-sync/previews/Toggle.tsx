import { Toggle } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 };
const row: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", fontSize: 14, color: "#3f3f46" };

export const OnAndOff = () => (
  <div style={col}>
    <div style={row}>
      <Toggle checked onCheckedChange={() => {}} /> Send recovery notifications
    </div>
    <div style={row}>
      <Toggle checked={false} onCheckedChange={() => {}} /> Pause monitoring during maintenance windows
    </div>
  </div>
);

export const States = () => (
  <div style={col}>
    <div style={row}>
      <Toggle checked disabled onCheckedChange={() => {}} /> SSL certificate checks (included in plan)
    </div>
    <div style={row}>
      <Toggle checked={false} disabled onCheckedChange={() => {}} /> SMS alerts (add a phone number first)
    </div>
    <div style={row}>
      <Toggle checked={false} invalid onCheckedChange={() => {}} /> Pick at least one alert type
    </div>
  </div>
);
