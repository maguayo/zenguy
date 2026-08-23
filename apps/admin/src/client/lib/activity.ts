import type { ActiveWorkspaceRow, WorkspaceActivitySummary } from "../../shared/types";

/**
 * Every event type the platform records, copied in catalog order from
 * `ACTIVITY_EVENTS` in apps/api/src/domain/activity/catalog.ts. The admin panel
 * cannot import from the API package, so this list is a copy: when the catalog
 * grows, grow this too. Anything not listed here is never sent as a filter,
 * because `GET /api/activity?type=` rejects what is not a lowercase
 * `subject.verb`.
 */
export const ACTIVITY_EVENT_TYPES = [
  "user.registered",
  "user.email_verified",
  "user.logged_in",
  "user.logged_out",
  "user.password_reset",
  "web.page_viewed",
  "app.screen_viewed",
  "app.opened",
  "browser_test.viewed",
  "run.viewed",
  "uptime_monitor.viewed",
  "incident.viewed",
  "workspace.created",
  "workspace.updated",
  "workspace.deleted",
  "workspace.ownership_transferred",
  "member.invited",
  "member.invitation_revoked",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "browser_test.created",
  "browser_test.updated",
  "browser_test.deleted",
  "browser_test.run_requested",
  "browser_test.validated",
  "browser_test.imported",
  "browser_test.exported",
  "browser_test.run_passed",
  "browser_test.run_failed",
  "browser_test.run_timed_out",
  "browser_test.run_errored",
  "report.downloaded",
  "uptime_monitor.created",
  "uptime_monitor.updated",
  "uptime_monitor.deleted",
  "uptime_monitor.tested",
  "incident.opened",
  "incident.resolved",
  "channel.created",
  "channel.updated",
  "channel.deleted",
  "channel.tested",
  "alert.sent",
  "alert.failed",
  "alerts.settings_updated",
  "alerts.topup_started",
  "alerts.credit_topup",
  "alerts.credit_adjusted",
  "secret.created",
  "secret.updated",
  "secret.deleted",
  "security.encryption_rotated",
  "api_key.created",
  "api_key.revoked",
  "api_key.used",
  "billing.checkout_started",
  "billing.subscription_updated",
  "billing.grant_issued",
  "billing.grant_redeemed",
  "push_device.registered",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const ACTIVITY_TYPE_STORAGE_KEY = "zenguy-admin:activity-type";

/** Subjects whose plain capitalisation would misspell them. */
const SUBJECT_LABEL: Record<string, string> = { api_key: "API key" };

/** "run_failed" → "run failed"; the verb phrase is left in its own voice. */
function words(token: string): string {
  return token.replace(/_/gu, " ");
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** "browser_test" → "Browser test". */
export function subjectLabel(subject: string): string {
  return SUBJECT_LABEL[subject] ?? capitalise(words(subject));
}

/**
 * An event type as a human reads it: "browser_test.run_failed" becomes
 * "Browser test · run failed". A type without a verb (nothing the server
 * stores, but the feed is not the place to throw) keeps its own text.
 */
export function labelForType(type: string): string {
  const dot = type.indexOf(".");
  if (dot === -1) return subjectLabel(type);
  return `${subjectLabel(type.slice(0, dot))} · ${words(type.slice(dot + 1))}`;
}

export interface ActivityTypeOption {
  /** The verb phrase alone: the group heading already names the subject. */
  label: string;
  type: string;
}

export interface ActivityTypeGroup {
  options: ActivityTypeOption[];
  subject: string;
}

/**
 * The catalog as the `<optgroup>`s of the filter: one group per subject, in the
 * order each subject first appears, with its types in catalog order. Subjects
 * are split across the catalog (browser_test views sit far above browser_test
 * runs), so grouping is what makes the list readable.
 */
export function groupActivityTypes(
  types: readonly string[] = ACTIVITY_EVENT_TYPES,
): ActivityTypeGroup[] {
  const groups = new Map<string, ActivityTypeGroup>();
  for (const type of types) {
    const dot = type.indexOf(".");
    const subject = dot === -1 ? type : type.slice(0, dot);
    const group = groups.get(subject) ?? { options: [], subject: subjectLabel(subject) };
    group.options.push({ label: dot === -1 ? type : words(type.slice(dot + 1)), type });
    groups.set(subject, group);
  }
  return [...groups.values()];
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(ACTIVITY_EVENT_TYPES);

/** A filter the server would accept, or null for "all events". */
export function parseActivityType(raw: string | null): ActivityEventType | null {
  return raw !== null && KNOWN_TYPES.has(raw) ? (raw as ActivityEventType) : null;
}

/**
 * The operator's last filter. Storage is best-effort: a panel opened in a
 * private window with storage blocked still boots on "all events".
 */
export function readStoredActivityType(): ActivityEventType | null {
  try {
    return parseActivityType(window.localStorage.getItem(ACTIVITY_TYPE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeActivityType(type: string | null): void {
  try {
    if (type === null) window.localStorage.removeItem(ACTIVITY_TYPE_STORAGE_KEY);
    else window.localStorage.setItem(ACTIVITY_TYPE_STORAGE_KEY, type);
  } catch {
    // A window that cannot remember the filter is still a working panel.
  }
}

/** Wide enough to carry a route or a channel, short enough to stay on one line. */
const MAX_SUMMARY_LENGTH = 80;

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

/**
 * The event's properties on a single line — "channel: email · route: /tests" —
 * or null when there is nothing to show. Values are stringified rather than
 * shaped: this is an ops panel, and the raw payload is the point.
 */
export function propertiesSummary(properties: Record<string, unknown> | null): string | null {
  if (properties === null) return null;
  const pairs = Object.entries(properties)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${stringifyValue(value)}`);
  if (pairs.length === 0) return null;
  const summary = pairs.join(" · ");
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
  return `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

/** Beyond this the tail alone identifies the row; the cell keeps the full id in `title`. */
const MAX_ID_TAIL = 8;
const ID_TAIL = 6;

/**
 * A resource id narrow enough for a dense row: "ntf_…qrstuv". Ids are
 * `prefix_<ulid>` and ULIDs are time-ordered, so neighbouring rows share their
 * leading characters — the prefix and the tail are what tell them apart.
 */
export function shortId(id: string): string {
  const separator = id.indexOf("_");
  if (separator === -1) return id;
  const tail = id.slice(separator + 1);
  if (tail.length <= MAX_ID_TAIL) return id;
  return `${id.slice(0, separator + 1)}…${tail.slice(-ID_TAIL)}`;
}

export interface WorkspaceRow extends WorkspaceActivitySummary {
  /** Its analytics row, or null when it ran nothing in the last 30 days. */
  analytics: ActiveWorkspaceRow | null;
}

/**
 * The workspaces endpoint carries the activity columns and the analytics range
 * carries the 30-day counters; they are joined by workspace id. Sorted by last
 * activity, newest first, with never-active workspaces last and the newest of
 * those first — the same order the SQL produces, restated here because the two
 * sources arrive independently.
 */
export function joinWorkspaceRows(
  workspaces: readonly WorkspaceActivitySummary[],
  active: readonly ActiveWorkspaceRow[] | undefined,
): WorkspaceRow[] {
  const byId = new Map((active ?? []).map((row) => [row.workspaceId, row]));
  return workspaces
    .map((workspace) => ({ ...workspace, analytics: byId.get(workspace.id) ?? null }))
    .sort(
      (left, right) =>
        (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0) || right.createdAt - left.createdAt,
    );
}
