import { Button } from "@zenguy/frontend";

const row: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

export const Variants = () => (
  <div style={row}>
    <Button variant="primary">Create test</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="danger">Delete monitor</Button>
    <Button variant="ghost">View logs</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button size="sm" variant="primary">Run now</Button>
    <Button size="md" variant="primary">Run now</Button>
    <Button size="lg" variant="primary">Run now</Button>
  </div>
);

export const States = () => (
  <div style={row}>
    <Button loading variant="primary">Saving…</Button>
    <Button disabled variant="secondary">Disabled</Button>
  </div>
);
