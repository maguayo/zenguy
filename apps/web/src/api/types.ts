export interface User {
  createdAt: string;
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
}

export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type SubscriptionStatus = "NONE" | "ACTIVE" | "PAST_DUE" | "CANCELED";
export type UserRef = { userId: string; name: string } | null;

export interface Workspace {
  createdAt: string;
  id: string;
  name: string;
  role: Role;
  slug: string;
  subscriptionStatus: SubscriptionStatus;
  timezone: string;
}

export interface Member {
  email: string;
  joinedAt: string;
  name: string;
  role: Role;
  userId: string;
}

export interface Invitation {
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  invitedBy: UserRef;
  role: "ADMIN" | "MEMBER";
}

export interface PublicInvitation {
  email: string;
  expiresAt: string;
  inviterName: string;
  role: "ADMIN" | "MEMBER";
  workspaceName: string;
}

export interface BillingConfig {
  clientToken: string;
  environment: "sandbox" | "production";
  priceId: string;
}

export interface Usage {
  billableRuns: number;
  includedRuns: 300;
  overageAmountCents: number;
  overageRuns: number;
  periodEnd: string;
  periodStart: string;
  projectedTotalCents: number;
  remainingRuns: number;
}

export interface Invoice {
  billedAt: string | null;
  currency: string;
  id: string;
  invoiceNumber: string | null;
  status: string;
  totalCents: number;
}

export interface Billing {
  invoices: Invoice[];
  plan: {
    currency: "EUR";
    includedRuns: 300;
    overagePerRunCents: 20;
    pricePerMonthCents: 3900;
  };
  subscription: {
    cancelAtPeriodEnd: boolean;
    cancelUrl: string | null;
    periodEnd: string | null;
    periodStart: string | null;
    status: SubscriptionStatus;
    updatePaymentMethodUrl: string | null;
  };
  usage: Usage;
}

export interface Secret {
  allowedDomains: string[];
  createdAt: string;
  createdBy: UserRef;
  description: string | null;
  id: string;
  key: string;
  updatedAt: string;
}

export type ChannelType = "EMAIL" | "SMS" | "WHATSAPP" | "CALL" | "SLACK" | "DISCORD";
export type ChannelConfigInput =
  | { emails: string[] }
  | { phoneNumber: string }
  | { webhookUrl: string };

export interface ChannelPreview {
  emails?: string[];
  phoneNumber?: string;
  webhookUrlMasked?: string;
}

export interface Channel {
  configPreview: ChannelPreview;
  createdAt: string;
  enabled: boolean;
  id: string;
  lastDeliveryStatus: "SENT" | "FAILED" | null;
  name: string;
  type: ChannelType;
  verifiedAt: string | null;
}

export interface Delivery {
  attemptCount: number;
  createdAt: string;
  errorSanitized: string | null;
  eventType: "FAILURE" | "RECOVERY" | "TEST";
  id: string;
  incidentId: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  status: "PENDING" | "SENT" | "FAILED";
}

export type Device = "DESKTOP" | "MOBILE";
export type RunSource = "VALIDATION" | "MANUAL" | "SCHEDULED";
export type RunStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";
export type AttemptStatus = RunStatus | "STARTING";

export type RunSummary = {
  createdAt: string;
  durationMs: number | null;
  finishedAt: string | null;
  id: string;
  passedAfterRetry: boolean;
  source: RunSource;
  startedAt: string | null;
  status: RunStatus;
} | null;

export interface BrowserTest {
  channelIds: string[];
  createdAt: string;
  createdBy: UserRef;
  device: Device;
  id: string;
  instructions: string;
  intervalHours: number;
  lastRun: RunSummary;
  maxRetries: number;
  name: string;
  nextRunAt: string;
  notifyOnRecovery: boolean;
  openIncidentId: string | null;
  startUrl: string;
  updatedAt: string;
}

export interface BrowserTestInput {
  channelIds: string[];
  device: Device;
  instructions: string;
  intervalHours: number;
  maxRetries: number;
  name: string;
  notifyOnRecovery: boolean;
  startUrl: string;
}

export interface RunListItem {
  attemptCount: number;
  billable: boolean;
  createdAt: string;
  device: Device;
  durationMs: number | null;
  id: string;
  passedAfterRetry: boolean;
  source: RunSource;
  status: RunStatus;
  triggeredBy: UserRef;
}

export interface RunSnapshot {
  channelIds: string[];
  device: Device;
  instructions: string;
  intervalHours: number;
  maxRetries: number;
  modelName: string;
  name: string;
  notifyOnRecovery: boolean;
  runnerVersion: string;
  startUrl: string;
  viewport: { height: number; width: number };
}

export interface AttemptSummary {
  attemptIndex: number;
  durationMs: number | null;
  failureReason: string | null;
  finishedAt: string | null;
  id: string;
  latestScreenshot: { id: string; url: string } | null;
  latestStep: { actionType: string; description: string; timestamp: string } | null;
  queuedAt: string;
  retryDelaySeconds: number;
  startedAt: string | null;
  status: AttemptStatus;
  summary: string | null;
}

export interface Run {
  attemptCount: number;
  attempts: AttemptSummary[];
  billable: boolean;
  durationMs: number | null;
  finishedAt: string | null;
  id: string;
  incidentId: string | null;
  live: { url: string } | null;
  passedAfterRetry: boolean;
  queuedAt: string;
  scheduledFor: string | null;
  snapshot: RunSnapshot;
  source: RunSource;
  startedAt: string | null;
  status: RunStatus;
  testId: string | null;
  triggeredBy: UserRef;
}

export interface ArtifactRef {
  expiresAt: string;
  id: string;
  url: string;
}

export interface Step {
  actionType: string;
  description: string;
  result: "OK" | "ERROR";
  screenshot: ArtifactRef | null;
  sequence: number;
  timestamp: string;
  urlSanitized: string | null;
}

export interface Attempt extends AttemptSummary {
  actualResult: string | null;
  consoleErrors: { level: string; message: string; timestamp: string; url: string | null }[];
  expectedResult: string | null;
  modelName: string | null;
  networkErrors: {
    durationMs: number | null;
    errorType: string | null;
    host: string;
    method: string;
    path: string;
    statusCode: number | null;
  }[];
  runnerVersion: string | null;
  screenshots: ArtifactRef[];
  steps: Step[];
  systemErrorCode: string | null;
  tokenUsage: number | null;
  visitedUrls: string[];
}

export type MonitorMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type BodyCondition = "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "JSON_PATH_EQUALS";
export type MonitorFrequency = 300 | 600 | 900 | 1800 | 3600 | 10800 | 21600 | 43200 | 86400;

export interface MonitorInput {
  body?: string;
  bodyCondition?: BodyCondition | null;
  bodyConditionPath?: string | null;
  bodyExpectedValue?: string | null;
  channelIds: string[];
  expectedStatus: number;
  frequencySeconds: MonitorFrequency;
  headers?: { key: string; value: string }[];
  maxRetries: number;
  method: MonitorMethod;
  name: string;
  notifyOnRecovery: boolean;
  timeoutSeconds: number;
  url: string;
}

export interface Monitor extends Omit<MonitorInput, "body" | "headers"> {
  body: string | null;
  checking: boolean;
  createdAt: string;
  createdBy: UserRef;
  headers: { key: string; value: string }[] | null;
  headersMasked: boolean;
  id: string;
  lastCheckAt: string | null;
  lastResponseTimeMs: number | null;
  nextCheckAt: string;
  openIncidentId: string | null;
  status: "UNKNOWN" | "UP" | "DOWN";
  updatedAt: string;
}

export interface TestRequestResult {
  conditions: { detail: string; passed: boolean; type: string }[];
  failureReason: string | null;
  httpStatus: number | null;
  passed: boolean;
  responseExcerpt: string | null;
  responseTimeMs: number;
}

export interface Check {
  attemptIndex: number;
  checkedAt: string;
  cycleId: string;
  failureReason: string | null;
  httpStatus: number | null;
  id: string;
  responseTimeMs: number | null;
  status: "PASSED" | "FAILED";
}

export interface MonitorStats {
  avgResponseTimeMs24h: number | null;
  series: { responseTimeMs: number | null; status: "PASSED" | "FAILED"; t: string }[];
  uptime24h: number | null;
  uptime30d: number | null;
  uptime7d: number | null;
}

export interface Incident {
  durationMs: number;
  id: string;
  lastEventAt: string;
  openedAt: string;
  resolvedAt: string | null;
  resourceId: string;
  resourceName: string;
  resourceType: "BROWSER_TEST" | "UPTIME_MONITOR";
  status: "OPEN" | "RESOLVED";
}

export interface IncidentEvent {
  createdAt: string;
  id: string;
  message: string;
  metadata: Record<string, unknown> | null;
  type:
    | "OPENED"
    | "FAILURE_RECORDED"
    | "NOTIFICATION_SENT"
    | "NOTIFICATION_FAILED"
    | "RESOLVED"
    | "TEST_DELETED"
    | "MONITOR_DELETED";
}

export interface IncidentDelivery {
  attemptCount: number;
  channelName: string;
  channelType: ChannelType;
  createdAt: string;
  errorSanitized: string | null;
  eventType: "FAILURE" | "RECOVERY";
  id: string;
  sentAt: string | null;
  status: "PENDING" | "SENT" | "FAILED";
}

export interface IncidentDetail extends Incident {
  deliveries: IncidentDelivery[];
  events: IncidentEvent[];
  openedByCheckId: string | null;
  openedByRunId: string | null;
}

export type ActivityType =
  | "TEST_PASSED"
  | "TEST_FAILED"
  | "TEST_TIMEOUT"
  | "TEST_SYSTEM_ERROR"
  | "TEST_RECOVERED"
  | "MONITOR_DOWN"
  | "MONITOR_RECOVERED"
  | "CHANNEL_DELIVERY_FAILED";

export interface ActivityItem {
  id: string;
  link: { channelId?: string; incidentId?: string; monitorId?: string; runId?: string };
  occurredAt: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  title: string;
  type: ActivityType;
}

export interface Overview {
  activity: ActivityItem[];
  browserTests: {
    failed24h: number;
    openIncidents: number;
    runningRuns: number;
    total: number;
  };
  uptime: {
    avgResponseTimeMs24h: number | null;
    down: number;
    openIncidents: number;
    unknown: number;
    up: number;
  };
  usage: Usage;
}

export interface AuditEntry {
  action: string;
  actor: UserRef;
  createdAt: string;
  id: string;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  resourceId: string | null;
  resourceType: string | null;
}
