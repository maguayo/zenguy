import { Button, DescriptionList, Field, Input, Modal, Select } from "@zenguy/frontend";

const noop = () => undefined;

export const AddNotificationChannel = () => (
  <Modal
    footer={
      <>
        <Button onClick={noop}>Cancel</Button>
        <Button onClick={noop} variant="primary">
          Create channel
        </Button>
      </>
    }
    onClose={noop}
    open
    title="Add notification channel"
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Field htmlFor="channel-type" label="Type">
        <Select defaultValue="slack" id="channel-type">
          <option value="slack">Slack</option>
          <option value="email">Email</option>
          <option value="webhook">Webhook</option>
        </Select>
      </Field>
      <Field
        hint="Incidents and recoveries are posted to this channel."
        htmlFor="channel-webhook"
        label="Webhook URL"
      >
        <Input
          defaultValue="https://hooks.slack.com/services/T024F/B07QX/9wkA"
          id="channel-webhook"
        />
      </Field>
    </div>
  </Modal>
);

export const RunDetails = () => (
  <Modal onClose={noop} open title="Run #4821 — Checkout flow">
    <DescriptionList
      items={[
        { label: "Status", value: "Passed" },
        { label: "Duration", value: "38.2s" },
        { label: "Browser", value: "Chromium 126" },
        { label: "Region", value: "eu-central" },
        { label: "Started", value: "Aug 25, 2026 · 09:14 CEST" },
        { label: "Source", value: "Scheduled" },
      ]}
    />
  </Modal>
);
