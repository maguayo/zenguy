import { Textarea } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 };

export const Filled = () => (
  <div style={col}>
    <Textarea defaultValue={"Open https://app.example.com/login\nSign in as qa@acme.dev\nAdd the annual plan to the cart and confirm the order total reads €49.00"} />
  </div>
);

export const Empty = () => (
  <div style={col}>
    <Textarea placeholder="Describe what this test should verify, step by step…" />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Textarea defaultValue="" invalid placeholder="Test steps are required" />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Textarea defaultValue="Incident notes are read-only after the incident is resolved." disabled />
  </div>
);
