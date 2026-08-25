import { Input } from "@zenguy/frontend";

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 };

export const FilledAndEmpty = () => (
  <div style={col}>
    <Input defaultValue="https://app.example.com/login" />
    <Input placeholder="e.g. Checkout smoke test" />
  </div>
);

export const Sizes = () => (
  <div style={col}>
    <Input controlSize="md" defaultValue="status.acme.dev" />
    <Input controlSize="lg" defaultValue="status.acme.dev" />
  </div>
);

export const Invalid = () => (
  <div style={col}>
    <Input defaultValue="not-a-url" invalid />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Input defaultValue="eu-west (Frankfurt)" disabled />
  </div>
);
