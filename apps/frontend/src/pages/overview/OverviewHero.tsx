import type { ReactNode } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";

import type {
  ActivityItem,
  ActivityType,
  Incident,
  Overview,
  OverviewRunningRun,
} from "../../api/types";
import { formatDuration, formatRelative } from "../../lib/format";

export type HeroState = "calm" | "empty" | "incident";
export type TickTone = "empty" | "fail" | "ok" | "run" | "warn";

export interface PulseSlot {
  label: string;
  tone: TickTone;
}

const PULSE_SIZE = 20;

const TONE_BY_TYPE: Record<ActivityType, Exclude<TickTone, "empty" | "run">> = {
  CHANNEL_DELIVERY_FAILED: "warn",
  MONITOR_DOWN: "fail",
  MONITOR_RECOVERED: "ok",
  TEST_FAILED: "fail",
  TEST_PASSED: "ok",
  TEST_RECOVERED: "ok",
  TEST_SYSTEM_ERROR: "warn",
  TEST_TIMEOUT: "warn",
};

export function tickTone(type: ActivityType): TickTone {
  return TONE_BY_TYPE[type];
}

export function pulseSlots(
  activity: ActivityItem[],
  running: OverviewRunningRun[] | undefined,
): PulseSlot[] {
  const finished = [...activity].reverse().map(
    (item): PulseSlot => ({
      label: `${item.title} · ${formatRelative(item.occurredAt)}`,
      tone: tickTone(item.type),
    }),
  );
  const live = [...(running ?? [])].reverse().map(
    (run): PulseSlot => ({ label: `${run.testName} · running`, tone: "run" }),
  );
  const results = [...finished, ...live].slice(-PULSE_SIZE);
  const padding = Array.from(
    { length: PULSE_SIZE - results.length },
    (): PulseSlot => ({ label: "", tone: "empty" }),
  );
  return [...padding, ...results];
}

export function pulseLabel(slots: PulseSlot[]): string {
  const counts = { fail: 0, ok: 0, run: 0, warn: 0 };
  for (const slot of slots) {
    if (slot.tone !== "empty") counts[slot.tone] += 1;
  }
  const total = counts.ok + counts.fail + counts.warn + counts.run;
  if (total === 0) return "No results yet.";
  const parts = [
    counts.ok > 0 ? `${counts.ok} passed` : null,
    counts.fail > 0 ? `${counts.fail} failed` : null,
    counts.warn > 0 ? `${counts.warn} ${counts.warn === 1 ? "warning" : "warnings"}` : null,
    counts.run > 0 ? `${counts.run} running` : null,
  ].filter((part): part is string => part !== null);
  return `Last ${total} ${total === 1 ? "result" : "results"}, oldest first: ${parts.join(", ")}.`;
}

export interface LiveChip {
  label: string;
  runId: string | null;
}

export function liveChip(
  running: OverviewRunningRun[] | undefined,
  runningRuns: number,
): LiveChip | null {
  const [newest] = running ?? [];
  if (newest === undefined) {
    return runningRuns > 0 ? { label: `${runningRuns} running`, runId: null } : null;
  }
  const extra = Math.max(runningRuns, (running ?? []).length) - 1;
  return {
    label: extra > 0 ? `${newest.testName} +${extra} · running` : `${newest.testName} · running`,
    runId: newest.id,
  };
}

export function heroState(data: Overview): HeroState {
  if (data.browserTests.openIncidents + data.uptime.openIncidents > 0) return "incident";
  const monitors = data.uptime.up + data.uptime.down + data.uptime.unknown;
  return data.browserTests.total + monitors === 0 ? "empty" : "calm";
}

export function heroHeadline(state: HeroState, openIncidents: number): string {
  if (state === "incident") {
    return `${openIncidents} ${openIncidents === 1 ? "incident" : "incidents"} open.`;
  }
  return state === "calm" ? "All quiet." : "Nothing under watch yet.";
}

const TICK_CLASS: Record<TickTone, string> = {
  empty: "bg-zinc-800",
  fail: "bg-red-500",
  ok: "bg-emerald-500",
  run: "hero-breathe bg-indigo-400",
  warn: "bg-amber-500",
};

function incidentStory(
  openIncident: Incident | null | undefined,
  openIncidents: number,
): ReactNode {
  if (!openIncident) return null;
  const verb =
    openIncident.resourceType === "UPTIME_MONITOR" ? "went down" : "started failing";
  const others = openIncidents - 1;
  return (
    <>
      <strong className="font-medium text-white">{openIncident.resourceName}</strong>{" "}
      {verb} {formatRelative(openIncident.openedAt)}.
      {others > 0
        ? ` ${others} more ${others === 1 ? "incident is" : "incidents are"} open.`
        : null}
    </>
  );
}

function calmStory(
  lastIncident: Incident | null | undefined,
  failed24h: number,
): ReactNode {
  const failures =
    failed24h > 0
      ? `${failed24h} failed ${failed24h === 1 ? "run" : "runs"} in the last 24 h. `
      : null;
  let memory: ReactNode = null;
  if (lastIncident === null) {
    memory = "No incidents so far.";
  } else if (lastIncident) {
    memory = (
      <>
        Last incident: <strong className="font-medium text-white">{lastIncident.resourceName}</strong>,{" "}
        {formatRelative(lastIncident.openedAt)}
        {lastIncident.status === "RESOLVED"
          ? ` — resolved in ${formatDuration(lastIncident.durationMs)}.`
          : "."}
      </>
    );
  }
  if (failures === null && memory === null) return null;
  return (
    <>
      {failures}
      {memory}
    </>
  );
}

export interface OverviewHeroProps {
  canManageTests: boolean;
  /** The most recent incident of any status; null when there has never been one, undefined while loading. */
  lastIncident: Incident | null | undefined;
  /** The newest open incident; undefined while loading or when nothing is open. */
  openIncident: Incident | null | undefined;
  overview: Overview;
  workspaceId: string;
}

export function OverviewHero({
  canManageTests,
  lastIncident,
  openIncident,
  overview: data,
  workspaceId,
}: OverviewHeroProps) {
  const state = heroState(data);
  const openIncidents = data.browserTests.openIncidents + data.uptime.openIncidents;
  const monitors = data.uptime.up + data.uptime.down + data.uptime.unknown;
  const slots = pulseSlots(data.activity, data.running);
  const chip = liveChip(data.running, data.browserTests.runningRuns);

  const story: ReactNode =
    state === "incident"
      ? incidentStory(openIncident, openIncidents)
      : state === "calm"
        ? calmStory(lastIncident, data.browserTests.failed24h)
        : "Create a browser test and zenguy will click through your site like a real user — and open an incident the moment something breaks.";

  const footer =
    state === "incident"
      ? { label: "Open incidents", to: `/w/${workspaceId}/incidents?status=open` }
      : state === "calm"
        ? { label: "Incident history", to: `/w/${workspaceId}/incidents` }
        : canManageTests
          ? { label: "Create your first test", to: `/w/${workspaceId}/tests/new` }
          : { label: "View tests", to: `/w/${workspaceId}/tests` };

  const chipClass =
    "inline-flex items-center gap-2 rounded-full bg-indigo-500/15 px-3 py-1 text-indigo-300";
  const chipDot = (
    <span aria-hidden="true" className="hero-breathe size-1.5 rounded-full bg-indigo-400" />
  );

  return (
    <section aria-labelledby="overview-hero-title" className="rounded-lg bg-zinc-950 p-6 sm:p-7">
      <h1
        className="text-3xl font-semibold tracking-tight text-white sm:text-4xl"
        id="overview-hero-title"
      >
        {heroHeadline(state, openIncidents)}
      </h1>
      {state === "empty" ? null : (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-zinc-400">
          <span>
            {data.browserTests.total} {data.browserTests.total === 1 ? "test" : "tests"} ·{" "}
            {monitors} {monitors === 1 ? "monitor" : "monitors"}
          </span>
          {chip === null ? null : chip.runId === null ? (
            <span className={chipClass}>
              {chipDot}
              {chip.label}
            </span>
          ) : (
            <Link
              className={clsx(chipClass, "hover:bg-indigo-500/25 hover:text-indigo-200")}
              to={`/w/${workspaceId}/runs/${chip.runId}`}
            >
              {chipDot}
              {chip.label}
            </Link>
          )}
        </div>
      )}
      <div
        aria-label={pulseLabel(slots)}
        className="mt-6 flex h-[18px] items-center gap-[3px]"
        role="img"
      >
        {slots.map((slot, index) => (
          <span
            key={index}
            className={clsx("h-full min-w-1 max-w-3 flex-1 rounded-[3px]", TICK_CLASS[slot.tone])}
            title={slot.label === "" ? undefined : slot.label}
          />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {story === null ? <span /> : (
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">{story}</p>
        )}
        <Link
          className="shrink-0 text-sm font-medium text-white underline-offset-4 hover:underline"
          to={footer.to}
        >
          {footer.label} →
        </Link>
      </div>
    </section>
  );
}
