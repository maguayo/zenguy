import { Select } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 };

export const CheckInterval = () => (
  <div style={col}>
    <Select defaultValue="5">
      <option value="1">Every minute</option>
      <option value="5">Every 5 minutes</option>
      <option value="15">Every 15 minutes</option>
      <option value="60">Every hour</option>
    </Select>
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Select defaultValue="" invalid>
      <option disabled value="">
        Select a notification channel…
      </option>
      <option value="email">Email — alerts@acme.dev</option>
      <option value="slack">Slack — #ops-alerts</option>
    </Select>
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Select defaultValue="eu-west" disabled>
      <option value="eu-west">eu-west (Frankfurt)</option>
      <option value="us-east">us-east (Virginia)</option>
    </Select>
  </div>
);
