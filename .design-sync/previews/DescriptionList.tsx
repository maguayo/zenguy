import { DescriptionList, RunSourceBadge, StatusBadge } from "@zenguy/frontend";

export const MonitorDetails = () => (
  <DescriptionList
    items={[
      { label: "URL", value: "https://app.acme.io/checkout" },
      { label: "Interval", value: "Every 5 minutes" },
      { label: "Region", value: "eu-central" },
      { label: "Status", value: <StatusBadge status="UP" /> },
      { label: "Last checked", value: "2 minutes ago" },
      { label: "Uptime (30 days)", value: "99.94%" },
    ]}
  />
);

export const RunSummary = () => (
  <DescriptionList
    items={[
      { label: "Test", value: "Checkout flow" },
      { label: "Source", value: <RunSourceBadge source="SCHEDULED" /> },
      { label: "Duration", value: "38.2s" },
      { label: "Browser", value: "Chromium 126" },
    ]}
  />
);
