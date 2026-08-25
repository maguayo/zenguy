import { Button, PageHeader, StatusBadge } from "@zenguy/frontend";

const noop = () => undefined;

export const MonitorsPage = () => (
  <PageHeader
    actions={
      <>
        <Button onClick={noop}>Import</Button>
        <Button onClick={noop} variant="primary">
          New monitor
        </Button>
      </>
    }
    description="Uptime checks across acme-prod, polled from three regions."
    title="Monitors"
  />
);

export const MonitorDetail = () => (
  <PageHeader
    actions={
      <>
        <Button onClick={noop} variant="ghost">
          Pause
        </Button>
        <Button onClick={noop} variant="primary">
          Run now
        </Button>
      </>
    }
    description="https://app.acme.io/checkout · every 5 minutes"
    title={
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        Checkout flow
        <StatusBadge status="UP" />
      </span>
    }
  />
);

export const TitleOnly = () => <PageHeader title="Notification channels" />;
