import { ChannelPicker } from "@zenguy/frontend";

const wrap: React.CSSProperties = { maxWidth: 640 };

const channels = [
  {
    configPreview: { emails: ["alerts@acme.dev"] },
    createdAt: "2026-05-12T09:24:00.000Z",
    enabled: true,
    id: "ch_email_alerts",
    isDefault: true,
    lastDeliveryStatus: "SENT" as const,
    name: "Team email — alerts@acme.dev",
    paused: null,
    price: null,
    reach: null,
    type: "EMAIL" as const,
    verifiedAt: "2026-05-12T09:30:00.000Z",
  },
  {
    configPreview: { webhookUrlMasked: "https://hooks.slack.com/services/T02…" },
    createdAt: "2026-05-20T14:02:00.000Z",
    enabled: true,
    id: "ch_slack_ops",
    isDefault: true,
    lastDeliveryStatus: "SENT" as const,
    name: "#ops-alerts",
    paused: null,
    price: null,
    reach: null,
    type: "SLACK" as const,
    verifiedAt: "2026-05-20T14:05:00.000Z",
  },
  {
    configPreview: { phoneNumber: "+34 ··· ·· 41 87" },
    createdAt: "2026-06-03T08:11:00.000Z",
    enabled: true,
    id: "ch_sms_oncall",
    isDefault: false,
    lastDeliveryStatus: "SENT" as const,
    name: "On-call phone",
    paused: null,
    price: { cents: 9, currency: "EUR" as const, destination: "ES" },
    reach: null,
    type: "SMS" as const,
    verifiedAt: "2026-06-03T08:15:00.000Z",
  },
  {
    configPreview: { phoneNumber: "+34 ··· ·· 41 87" },
    createdAt: "2026-06-03T08:20:00.000Z",
    enabled: true,
    id: "ch_call_oncall",
    isDefault: false,
    lastDeliveryStatus: "FAILED" as const,
    name: "Escalation call",
    paused: { reason: "NO_CREDIT" as const },
    price: { cents: 25, currency: "EUR" as const, destination: "ES" },
    reach: null,
    type: "CALL" as const,
    verifiedAt: "2026-06-03T08:25:00.000Z",
  },
];

export const WithChannels = () => (
  <div style={wrap}>
    <ChannelPicker
      channels={channels}
      error={false}
      loading={false}
      manageHref="/alerts/channels"
      onChange={() => {}}
      onRetry={() => {}}
      value={["ch_email_alerts", "ch_slack_ops", "ch_sms_oncall"]}
    />
  </div>
);

export const Empty = () => (
  <div style={wrap}>
    <ChannelPicker
      channels={[]}
      error={false}
      loading={false}
      manageHref="/alerts/channels"
      onChange={() => {}}
      onRetry={() => {}}
      value={[]}
    />
  </div>
);

export const Loading = () => (
  <div style={wrap}>
    <ChannelPicker
      channels={[]}
      error={false}
      loading
      manageHref="/alerts/channels"
      onChange={() => {}}
      onRetry={() => {}}
      value={[]}
    />
  </div>
);

export const LoadError = () => (
  <div style={wrap}>
    <ChannelPicker
      channels={[]}
      error
      loading={false}
      manageHref="/alerts/channels"
      onChange={() => {}}
      onRetry={() => {}}
      value={[]}
    />
  </div>
);
