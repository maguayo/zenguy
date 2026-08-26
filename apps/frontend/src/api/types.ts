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

export type SubscriptionSource = "free" | "grant" | "paddle" | "stripe";

interface BillingConfigBase {
  canIssueComplimentaryGrants?: boolean;
}

export interface FreeBillingConfig extends BillingConfigBase {
  mode: "free";
}

export interface StripeBillingConfig extends BillingConfigBase {
  mode: "stripe";
  environment: "test" | "live";
}

export type BillingConfig =
  | FreeBillingConfig
  | StripeBillingConfig;

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
    overagePerRunCents: number;
    pricePerMonthCents: number;
  };
  subscription: {
    cancelAtPeriodEnd: boolean;
    cancelUrl: string | null;
    periodEnd: string | null;
    periodStart: string | null;
    source?: SubscriptionSource;
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

export type ChannelType = "EMAIL" | "SMS" | "WHATSAPP" | "CALL" | "SLACK" | "DISCORD" | "PUSH";
export type ChannelConfigInput =
  | { emails: string[] }
  | { consent: true; phoneNumber: string }
  | { phoneNumber: string }
  | { webhookUrl: string }
  | { recipients: "WORKSPACE_MEMBERS" };

export interface ChannelPreview {
  emails?: string[];
  phoneNumber?: string;
  recipients?: "WORKSPACE_MEMBERS";
  webhookUrlMasked?: string;
}

export type PaidAlertsPauseReason = "PAID_OFF" | "NO_CREDIT";

export interface ChannelPrice {
  cents: number;
  currency: "EUR";
  destination: string;
}

export interface Channel {
  configPreview: ChannelPreview;
  createdAt: string;
  enabled: boolean;
  id: string;
  /** Preselected for new tests and monitors. */
  isDefault: boolean;
  lastDeliveryStatus: "SENT" | "FAILED" | "AMBIGUOUS" | null;
  name: string;
  /** Why a pay-as-you-go channel cannot deliver right now; null when it can. */
  paused: { reason: PaidAlertsPauseReason } | null;
  /** Price per alert for SMS, call, and WhatsApp channels; null for free ones. */
  price: ChannelPrice | null;
  /** Devices and members a mobile push channel reaches; null for other types. */
  reach: { devices: number; members: number } | null;
  type: ChannelType;
  verifiedAt: string | null;
}

export interface Delivery {
  attemptCount: number;
  costCents: number | null;
  createdAt: string;
  destinationCountry: string | null;
  errorSanitized: string | null;
  eventType: "FAILURE" | "RECOVERY" | "TEST";
  id: string;
  incidentId: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  status: "PENDING" | "SENT" | "FAILED" | "AMBIGUOUS";
}

export type Device = "DESKTOP" | "MOBILE";
export type RunSource = "VALIDATION" | "MANUAL" | "SCHEDULED";
export type RunStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";
export type AttemptStatus = RunStatus | "STARTING";
export type IrreversibleActionScope =
  | {
      kind: "DOM";
      action: "CLICK";
      origin: string;
      path: string;
      target: {
        attribute: "data-testid" | "id" | "name" | "aria-label";
        value: string;
        tag: "BUTTON" | "INPUT";
        type: "submit";
        form: {
          method: "POST";
          origin: string;
          path: string;
        };
      };
      maxUses: number;
    }
  | {
      kind: "HTTP";
      method: "POST" | "PUT" | "PATCH" | "DELETE";
      origin: string;
      path: string;
      maxUses: number;
    };

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
  allowedDomains?: string[];
  writableDomains?: string[];
  testDataAttested?: boolean;
  irreversibleActionScopes?: IrreversibleActionScope[];
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
  allowedDomains: string[];
  writableDomains: string[];
  testDataAttested: boolean;
  irreversibleActionScopes: IrreversibleActionScope[];
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
  allowedDomains?: string[];
  writableDomains?: string[];
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

export type RunnerKind = "primary" | "fallback";

export interface AttemptSummary {
  attemptIndex: number;
  durationMs: number | null;
  failureReason: string | null;
  finishedAt: string | null;
  id: string;
  inputTokens: number | null;
  latestScreenshot: { id: string; url: string } | null;
  latestStep: { actionType: string; description: string; timestamp: string } | null;
  modelName: string | null;
  outputTokens: number | null;
  queuedAt: string;
  retryDelaySeconds: number;
  runnerKind: RunnerKind | null;
  runnerVersion: string | null;
  startedAt: string | null;
  status: AttemptStatus;
  summary: string | null;
  tokenUsage: number | null;
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
  networkErrors: {
    durationMs: number | null;
    errorType: string | null;
    host: string;
    method: string;
    path: string;
    statusCode: number | null;
  }[];
  screenshots: ArtifactRef[];
  steps: Step[];
  systemErrorCode: string | null;
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

export interface Monitor
  extends Omit<
    MonitorInput,
    "body" | "bodyCondition" | "bodyConditionPath" | "bodyExpectedValue" | "headers"
  > {
  body: string | null;
  bodyCondition: BodyCondition | null;
  bodyConditionPath: string | null;
  bodyExpectedValue: string | null;
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
  costCents: number | null;
  createdAt: string;
  destinationCountry: string | null;
  errorSanitized: string | null;
  eventType: "FAILURE" | "RECOVERY";
  id: string;
  sentAt: string | null;
  status: "PENDING" | "SENT" | "FAILED" | "AMBIGUOUS";
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

export type AlertRegion = "US_CA" | "EUROPE" | "ROW";

export interface CountryPrice {
  callCents: number;
  iso: string;
  name: string;
  region: AlertRegion;
  smsCents: number;
}

export interface PricingRegion {
  countries: CountryPrice[];
  flat: { callCents: number; smsCents: number } | null;
  key: AlertRegion;
  name: string;
}

export interface PricingTable {
  capturedOn: string;
  currency: "EUR";
  markup: number;
  regions: PricingRegion[];
}

export interface AlertsOverview {
  credit: {
    balanceCents: number;
    currency: "EUR";
    lowBalance: boolean;
    lowBalanceThresholdCents: number;
    paidAlertsLast24h: number;
  } | null;
  destinations: { channels: number; iso: string | null; name: string }[];
  pricing: PricingTable;
  settings: { dailyPaidAlertLimit: number; paidChannelsEnabled: boolean };
  status: {
    paidAlertsPaused: boolean;
    paidChannelCount: number;
    pauseReason: PaidAlertsPauseReason | null;
  };
  topUp: { available: boolean; maxPacks: number; minPacks: number; packCents: number };
}

export interface AlertSettings {
  dailyPaidAlertLimit: number;
  paidChannelsEnabled: boolean;
  updatedAt: string;
}

export interface AlertQuote {
  callCents: number;
  currency: "EUR";
  destination: { iso: string | null; name: string; region: AlertRegion };
  smsCents: number;
}

export type CreditEntryKind = "TOPUP" | "GRANT" | "CHARGE" | "REFUND" | "ADJUSTMENT";

export interface CreditEntry {
  amountCents: number;
  balanceAfterCents: number;
  createdAt: string;
  deliveryId: string | null;
  description: string;
  id: string;
  kind: CreditEntryKind;
}

export interface StripeCheckoutIntent {
  amountCents: number;
  currencyCode: "EUR";
  url: string;
}

export type BillingCheckoutIntent = StripeCheckoutIntent;
export type CreditTopUpCheckout = BillingCheckoutIntent;

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
