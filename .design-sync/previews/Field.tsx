import { Field, Input, Select } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 20, maxWidth: 420 };

export const WithHint = () => (
  <div style={col}>
    <Field
      hint="Shown in alerts and on the status dashboard."
      htmlFor="field-monitor-name"
      label="Monitor name"
    >
      <Input defaultValue="Checkout — production" id="field-monitor-name" />
    </Field>
  </div>
);

export const RequiredWithError = () => (
  <div style={col}>
    <Field
      error="Enter a valid URL, including https://."
      htmlFor="field-monitor-url"
      label="URL to monitor"
      required
    >
      <Input defaultValue="app.example.com/login" id="field-monitor-url" invalid />
    </Field>
  </div>
);

export const WithSelect = () => (
  <div style={col}>
    <Field
      hint="How often Zenguy pings this endpoint."
      htmlFor="field-check-interval"
      label="Check interval"
    >
      <Select defaultValue="5" id="field-check-interval">
        <option value="1">Every minute</option>
        <option value="5">Every 5 minutes</option>
        <option value="15">Every 15 minutes</option>
        <option value="60">Every hour</option>
      </Select>
    </Field>
  </div>
);
