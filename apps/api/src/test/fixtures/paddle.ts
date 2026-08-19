export const PADDLE_SUBSCRIPTION_CREATED = {
  event_id: "evt_subscription_created",
  event_type: "subscription.created",
  occurred_at: "2026-08-01T00:00:01Z",
  notification_id: "ntf_subscription_created",
  data: {
    id: "sub_provider_123",
    customer_id: "ctm_provider_123",
    status: "active",
    custom_data: { workspace_id: "ws_primary" },
    current_billing_period: {
      starts_at: "2026-08-01T00:00:00Z",
      ends_at: "2026-09-01T00:00:00Z",
    },
    scheduled_change: null,
    management_urls: {
      update_payment_method: "https://paddle.test/update/created",
      cancel: "https://paddle.test/cancel/created",
    },
  },
} as const;

export const PADDLE_SUBSCRIPTION_UPDATED = {
  event_id: "evt_subscription_updated",
  event_type: "subscription.updated",
  occurred_at: "2026-09-01T00:00:01Z",
  notification_id: "ntf_subscription_updated",
  data: {
    id: "sub_provider_123",
    customer_id: "ctm_provider_123",
    status: "past_due",
    custom_data: { workspace_id: "ws_primary" },
    current_billing_period: {
      starts_at: "2026-09-01T00:00:00Z",
      ends_at: "2026-10-01T00:00:00Z",
    },
    scheduled_change: { action: "cancel", effective_at: "next_billing_period" },
    management_urls: {
      update_payment_method: "https://paddle.test/update/new",
      cancel: "https://paddle.test/cancel/new",
    },
  },
} as const;
