import { Badge, Button, Card } from "@zenguy/frontend";

const meta: React.CSSProperties = { fontSize: 13, color: "#52525b", margin: 0 };

export const MonitorOverview = () => (
  <Card title="Uptime — last 24 hours">
    <p style={meta}>
      api.zenguy.com responded to 1,438 of 1,440 checks. Two failures at 03:12 UTC
      triggered incident #482, resolved after 6 minutes.
    </p>
  </Card>
);

export const WithActions = () => (
  <Card
    actions={
      <>
        <Badge tone="ok">Passing</Badge>
        <Button size="sm" variant="secondary">Run now</Button>
      </>
    }
    title="Checkout flow"
  >
    <p style={meta}>Runs every 30 minutes from eu-west. Last run passed in 48s.</p>
  </Card>
);

export const PaddingVariants = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <Card padding="md" title="Notification channels">
      <p style={meta}>Slack #alerts and email to ops@zenguy.com.</p>
    </Card>
    <Card padding="sm" title="Regions">
      <p style={meta}>eu-west, us-east</p>
    </Card>
    <Card padding="none">
      <div style={{ padding: 12, borderBottom: "1px solid #e4e4e7", fontSize: 13, fontWeight: 600 }}>
        Recent incidents
      </div>
      <div style={{ padding: 12, fontSize: 13, color: "#52525b" }}>
        #482 — api.zenguy.com timeout, resolved
      </div>
    </Card>
  </div>
);

export const TitleOnly = () => <Card title="Billing" />;
