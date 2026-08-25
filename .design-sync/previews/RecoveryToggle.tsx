import { RecoveryToggle } from "@zenguy/frontend";

const wrap: React.CSSProperties = { maxWidth: 560 };

export const MonitorOn = () => (
  <div style={wrap}>
    <RecoveryToggle
      checked
      id="recovery-monitor"
      onCheckedChange={() => {}}
      resource="monitor"
    />
  </div>
);

export const TestOff = () => (
  <div style={wrap}>
    <RecoveryToggle
      checked={false}
      id="recovery-test"
      onCheckedChange={() => {}}
      resource="test"
    />
  </div>
);
