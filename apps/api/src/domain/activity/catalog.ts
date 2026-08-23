import { AUDIT_ACTIONS, type AuditAction } from "../audit/actions";

/**
 * Every activity event the platform records. `<subject>.<past tense verb>`.
 * Clients send these strings; the server drops anything not listed here.
 */
export const ACTIVITY_EVENTS = {
  userRegistered: "user.registered",
  userEmailVerified: "user.email_verified",
  userLoggedIn: "user.logged_in",
  userLoggedOut: "user.logged_out",
  userPasswordReset: "user.password_reset",
  webPageViewed: "web.page_viewed",
  appScreenViewed: "app.screen_viewed",
  appOpened: "app.opened",
  browserTestViewed: "browser_test.viewed",
  runViewed: "run.viewed",
  uptimeMonitorViewed: "uptime_monitor.viewed",
  incidentViewed: "incident.viewed",
  workspaceCreated: "workspace.created",
  workspaceUpdated: "workspace.updated",
  workspaceDeleted: "workspace.deleted",
  workspaceOwnershipTransferred: "workspace.ownership_transferred",
  memberInvited: "member.invited",
  memberInvitationRevoked: "member.invitation_revoked",
  memberJoined: "member.joined",
  memberRoleChanged: "member.role_changed",
  memberRemoved: "member.removed",
  browserTestCreated: "browser_test.created",
  browserTestUpdated: "browser_test.updated",
  browserTestDeleted: "browser_test.deleted",
  browserTestRunRequested: "browser_test.run_requested",
  browserTestValidated: "browser_test.validated",
  browserTestImported: "browser_test.imported",
  browserTestExported: "browser_test.exported",
  browserTestRunPassed: "browser_test.run_passed",
  browserTestRunFailed: "browser_test.run_failed",
  browserTestRunTimedOut: "browser_test.run_timed_out",
  browserTestRunErrored: "browser_test.run_errored",
  reportDownloaded: "report.downloaded",
  uptimeMonitorCreated: "uptime_monitor.created",
  uptimeMonitorUpdated: "uptime_monitor.updated",
  uptimeMonitorDeleted: "uptime_monitor.deleted",
  uptimeMonitorTested: "uptime_monitor.tested",
  incidentOpened: "incident.opened",
  incidentResolved: "incident.resolved",
  channelCreated: "channel.created",
  channelUpdated: "channel.updated",
  channelDeleted: "channel.deleted",
  channelTested: "channel.tested",
  alertSent: "alert.sent",
  alertFailed: "alert.failed",
  alertsSettingsUpdated: "alerts.settings_updated",
  alertsTopupStarted: "alerts.topup_started",
  alertsCreditTopup: "alerts.credit_topup",
  alertsCreditAdjusted: "alerts.credit_adjusted",
  secretCreated: "secret.created",
  secretUpdated: "secret.updated",
  secretDeleted: "secret.deleted",
  encryptionRotated: "security.encryption_rotated",
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
  apiKeyUsed: "api_key.used",
  billingCheckoutStarted: "billing.checkout_started",
  billingSubscriptionUpdated: "billing.subscription_updated",
  billingGrantIssued: "billing.grant_issued",
  billingGrantRedeemed: "billing.grant_redeemed",
  pushDeviceRegistered: "push_device.registered",
} as const;

export type ActivityEventType =
  (typeof ACTIVITY_EVENTS)[keyof typeof ACTIVITY_EVENTS];

export type ActivityScope = "user" | "workspace" | "any";
export type ActivityVolume = "high" | "normal";

export interface ActivityEventSpec {
  /** workspace ⇒ workspaceId required; user ⇒ must be absent; any ⇒ optional. */
  scope: ActivityScope;
  /** Stored as resource_type when the event carries a resourceId. */
  resourceType: string | null;
  /** true ⇒ a client may report it through POST /api/me/events. */
  client: boolean;
  /** high ⇒ purged after 90 days; normal ⇒ after 365 days. */
  volume: ActivityVolume;
}

function spec(
  scope: ActivityScope,
  resourceType: string | null,
  options: { client?: boolean; volume?: ActivityVolume } = {},
): ActivityEventSpec {
  return {
    scope,
    resourceType,
    client: options.client ?? false,
    volume: options.volume ?? "normal",
  };
}

const visit = (resourceType: string | null, scope: ActivityScope = "workspace") =>
  spec(scope, resourceType, { client: true, volume: "high" });

export const ACTIVITY_EVENT_SPECS: Record<ActivityEventType, ActivityEventSpec> = {
  "user.registered": spec("user", null),
  "user.email_verified": spec("user", null),
  "user.logged_in": spec("user", null),
  "user.logged_out": spec("user", null),
  "user.password_reset": spec("any", "user"),
  "web.page_viewed": visit(null, "any"),
  "app.screen_viewed": visit(null, "any"),
  "app.opened": visit(null, "user"),
  "browser_test.viewed": visit("browser_test"),
  "run.viewed": visit("run"),
  "uptime_monitor.viewed": visit("uptime_monitor"),
  "incident.viewed": visit("incident"),
  "workspace.created": spec("workspace", "workspace"),
  "workspace.updated": spec("workspace", "workspace"),
  "workspace.deleted": spec("workspace", "workspace"),
  "workspace.ownership_transferred": spec("workspace", "workspace"),
  "member.invited": spec("workspace", "member"),
  "member.invitation_revoked": spec("workspace", "member"),
  "member.joined": spec("workspace", "member"),
  "member.role_changed": spec("workspace", "member"),
  "member.removed": spec("workspace", "member"),
  "browser_test.created": spec("workspace", "browser_test"),
  "browser_test.updated": spec("workspace", "browser_test"),
  "browser_test.deleted": spec("workspace", "browser_test"),
  "browser_test.run_requested": spec("workspace", "browser_test"),
  "browser_test.validated": spec("workspace", null),
  "browser_test.imported": spec("workspace", null),
  "browser_test.exported": spec("workspace", null),
  "browser_test.run_passed": spec("workspace", "browser_test", { volume: "high" }),
  "browser_test.run_failed": spec("workspace", "browser_test", { volume: "high" }),
  "browser_test.run_timed_out": spec("workspace", "browser_test", { volume: "high" }),
  "browser_test.run_errored": spec("workspace", "browser_test", { volume: "high" }),
  "report.downloaded": spec("workspace", "run"),
  "uptime_monitor.created": spec("workspace", "uptime_monitor"),
  "uptime_monitor.updated": spec("workspace", "uptime_monitor"),
  "uptime_monitor.deleted": spec("workspace", "uptime_monitor"),
  "uptime_monitor.tested": spec("workspace", null),
  "incident.opened": spec("workspace", "incident"),
  "incident.resolved": spec("workspace", "incident"),
  "channel.created": spec("workspace", "channel"),
  "channel.updated": spec("workspace", "channel"),
  "channel.deleted": spec("workspace", "channel"),
  "channel.tested": spec("workspace", "channel"),
  "alert.sent": spec("workspace", "notification_delivery", { volume: "high" }),
  "alert.failed": spec("workspace", "notification_delivery", { volume: "high" }),
  // Bridged audit actions forward the audit's resourceId, so every bridged
  // type names its resource (same names the audit rows use).
  "alerts.settings_updated": spec("workspace", "alert_settings"),
  "alerts.topup_started": spec("workspace", null),
  "alerts.credit_topup": spec("workspace", "alert_credit"),
  "alerts.credit_adjusted": spec("workspace", "alert_credit"),
  "secret.created": spec("workspace", "secret"),
  "secret.updated": spec("workspace", "secret"),
  "secret.deleted": spec("workspace", "secret"),
  "security.encryption_rotated": spec("workspace", "workspace_encryption"),
  "api_key.created": spec("workspace", "api_key"),
  "api_key.revoked": spec("workspace", "api_key"),
  "api_key.used": spec("workspace", "api_key", { volume: "high" }),
  "billing.checkout_started": spec("workspace", null),
  "billing.subscription_updated": spec("workspace", "subscription"),
  "billing.grant_issued": spec("workspace", "subscription_grant"),
  "billing.grant_redeemed": spec("workspace", "subscription_grant"),
  "push_device.registered": spec("user", "push_device"),
};

/**
 * Audited mutations are bridged into activity by `WriteAudit`. Exhaustive by
 * type over `AuditAction`; the string-keyed entries cover actions that exist
 * only in the in-flight security work, so the map compiles on either side.
 */
export const AUDIT_TO_ACTIVITY: Record<AuditAction, ActivityEventType> &
  Record<string, ActivityEventType> = {
  [AUDIT_ACTIONS.workspaceCreated]: ACTIVITY_EVENTS.workspaceCreated,
  [AUDIT_ACTIONS.workspaceUpdated]: ACTIVITY_EVENTS.workspaceUpdated,
  [AUDIT_ACTIONS.workspaceDeleted]: ACTIVITY_EVENTS.workspaceDeleted,
  [AUDIT_ACTIONS.workspaceOwnershipTransferred]:
    ACTIVITY_EVENTS.workspaceOwnershipTransferred,
  [AUDIT_ACTIONS.memberInvited]: ACTIVITY_EVENTS.memberInvited,
  [AUDIT_ACTIONS.memberInvitationRevoked]: ACTIVITY_EVENTS.memberInvitationRevoked,
  [AUDIT_ACTIONS.memberJoined]: ACTIVITY_EVENTS.memberJoined,
  [AUDIT_ACTIONS.memberRoleChanged]: ACTIVITY_EVENTS.memberRoleChanged,
  [AUDIT_ACTIONS.memberRemoved]: ACTIVITY_EVENTS.memberRemoved,
  [AUDIT_ACTIONS.secretCreated]: ACTIVITY_EVENTS.secretCreated,
  [AUDIT_ACTIONS.secretUpdated]: ACTIVITY_EVENTS.secretUpdated,
  [AUDIT_ACTIONS.secretDeleted]: ACTIVITY_EVENTS.secretDeleted,
  "security.encryption_rotated": ACTIVITY_EVENTS.encryptionRotated,
  [AUDIT_ACTIONS.channelCreated]: ACTIVITY_EVENTS.channelCreated,
  [AUDIT_ACTIONS.channelUpdated]: ACTIVITY_EVENTS.channelUpdated,
  [AUDIT_ACTIONS.channelDeleted]: ACTIVITY_EVENTS.channelDeleted,
  [AUDIT_ACTIONS.channelTested]: ACTIVITY_EVENTS.channelTested,
  [AUDIT_ACTIONS.testCreated]: ACTIVITY_EVENTS.browserTestCreated,
  [AUDIT_ACTIONS.testUpdated]: ACTIVITY_EVENTS.browserTestUpdated,
  [AUDIT_ACTIONS.testDeleted]: ACTIVITY_EVENTS.browserTestDeleted,
  [AUDIT_ACTIONS.testRunManual]: ACTIVITY_EVENTS.browserTestRunRequested,
  [AUDIT_ACTIONS.monitorCreated]: ACTIVITY_EVENTS.uptimeMonitorCreated,
  [AUDIT_ACTIONS.monitorUpdated]: ACTIVITY_EVENTS.uptimeMonitorUpdated,
  [AUDIT_ACTIONS.monitorDeleted]: ACTIVITY_EVENTS.uptimeMonitorDeleted,
  [AUDIT_ACTIONS.billingSubscriptionUpdated]:
    ACTIVITY_EVENTS.billingSubscriptionUpdated,
  [AUDIT_ACTIONS.billingGrantIssued]: ACTIVITY_EVENTS.billingGrantIssued,
  [AUDIT_ACTIONS.billingGrantRedeemed]: ACTIVITY_EVENTS.billingGrantRedeemed,
  [AUDIT_ACTIONS.alertsSettingsUpdated]: ACTIVITY_EVENTS.alertsSettingsUpdated,
  [AUDIT_ACTIONS.alertsCreditTopup]: ACTIVITY_EVENTS.alertsCreditTopup,
  "alerts.credit_adjusted": ACTIVITY_EVENTS.alertsCreditAdjusted,
  [AUDIT_ACTIONS.authPasswordReset]: ACTIVITY_EVENTS.userPasswordReset,
  [AUDIT_ACTIONS.apiKeyCreated]: ACTIVITY_EVENTS.apiKeyCreated,
  [AUDIT_ACTIONS.apiKeyRevoked]: ACTIVITY_EVENTS.apiKeyRevoked,
};

export function isActivityEventType(value: string): value is ActivityEventType {
  return Object.hasOwn(ACTIVITY_EVENT_SPECS, value);
}

export function activityEventTypesByVolume(
  volume: ActivityVolume,
): ActivityEventType[] {
  return (Object.keys(ACTIVITY_EVENT_SPECS) as ActivityEventType[]).filter(
    (type) => ACTIVITY_EVENT_SPECS[type].volume === volume,
  );
}

export const CLIENT_ACTIVITY_EVENT_TYPES: ActivityEventType[] = (
  Object.keys(ACTIVITY_EVENT_SPECS) as ActivityEventType[]
).filter((type) => ACTIVITY_EVENT_SPECS[type].client);
