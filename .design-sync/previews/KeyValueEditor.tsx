import { KeyValueEditor } from "@zenguy/frontend";

const wrap: React.CSSProperties = { maxWidth: 560 };

export const RequestHeaders = () => (
  <div style={wrap}>
    <KeyValueEditor
      keyPlaceholder="Header name"
      onChange={() => {}}
      value={[
        { key: "Authorization", value: "Bearer sk_live_9f2c…" },
        { key: "X-Request-Source", value: "zenguy-monitor" },
      ]}
      valuePlaceholder="Header value"
    />
  </div>
);

export const EmptyRow = () => (
  <div style={wrap}>
    <KeyValueEditor
      keyPlaceholder="Header name"
      onChange={() => {}}
      value={[{ key: "", value: "" }]}
      valuePlaceholder="Header value"
    />
  </div>
);
