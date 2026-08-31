import type { ReactNode } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";

import type { Incident, Overview } from "../../api/types";

export type HeroState = "calm" | "empty" | "incident";

export function heroState(data: Overview): HeroState {
  if (data.browserTests.openIncidents + data.uptime.openIncidents > 0) return "incident";
  const monitors = data.uptime.up + data.uptime.down + data.uptime.unknown;
  return data.browserTests.total + monitors === 0 ? "empty" : "calm";
}

export function heroHeadline(state: HeroState, openIncidents: number): string {
  if (state === "incident") {
    return `${openIncidents} ${openIncidents === 1 ? "incidencia abierta" : "incidencias abiertas"}`;
  }
  return state === "calm" ? "Todo en calma" : "Aún no hay nada bajo vigilancia";
}

export function compactDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0) return `${hours} h${remainder > 0 ? ` ${remainder} m` : ""}`;
  if (minutes > 0) return `${minutes} m`;
  return `${Math.max(1, Math.floor(ms / 1_000))} s`;
}

export function compactRelative(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "—";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "ahora";
  if (elapsed < 3_600_000) return `hace ${Math.max(1, Math.round(elapsed / 60_000))} m`;
  if (elapsed < 86_400_000) return `hace ${Math.max(1, Math.round(elapsed / 3_600_000))} h`;
  return `hace ${Math.max(1, Math.round(elapsed / 86_400_000))} d`;
}

const HERO_TONE: Record<HeroState, { halo: string; dot: string }> = {
  calm: { halo: "bg-[#d7fce3]", dot: "bg-[#169941]" },
  empty: { halo: "bg-indigo-100/80", dot: "bg-indigo-500" },
  incident: { halo: "bg-red-100", dot: "bg-red-600" },
};

function metricValue(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(value);
}

function HeroMetric({
  label,
  tone = "neutral",
  unit,
  value,
}: {
  label: ReactNode;
  tone?: "neutral" | "ok" | "danger";
  unit?: "%" | "ms";
  value: string | number;
}) {
  return (
    <div className="min-w-0 text-right tabular-nums">
      <p className="whitespace-nowrap text-[10px] font-semibold uppercase leading-4 tracking-[0.025em] text-zinc-400 2xl:text-[11px]">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 whitespace-nowrap text-xl font-semibold leading-6 tracking-[-0.035em] 2xl:text-2xl 2xl:leading-7",
          tone === "ok" && "text-emerald-600",
          tone === "danger" && "text-red-600",
          tone === "neutral" && "text-zinc-950",
        )}
      >
        {value}
        {unit === "%" ? <span className="ml-0.5">%</span> : null}
        {unit === "ms" ? (
          <>
            {" "}<span className="text-[0.8em] tracking-normal">ms</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export interface OverviewHeroProps {
  canManageTests: boolean;
  lastIncident: Incident | null | undefined;
  openIncident: Incident | null | undefined;
  overview: Overview;
  workspaceId: string;
}

export function OverviewHero({
  canManageTests,
  lastIncident,
  openIncident,
  overview,
  workspaceId,
}: OverviewHeroProps) {
  const state = heroState(overview);
  const openIncidents = overview.browserTests.openIncidents + overview.uptime.openIncidents;
  const tone = HERO_TONE[state];
  const uptimeTone =
    overview.uptime.uptime30d === null || overview.uptime.uptime30d === undefined
      ? "neutral"
      : overview.uptime.uptime30d >= 99.9
        ? "ok"
        : "danger";

  let story: ReactNode;
  if (state === "incident") {
    story = openIncident ? (
      <>
        <strong className="font-medium text-zinc-800">{openIncident.resourceName}</strong> tiene una
        incidencia desde {compactRelative(openIncident.openedAt)}.
      </>
    ) : (
      "Hay servicios que necesitan atención."
    );
  } else if (state === "empty") {
    story = "Crea un test o un monitor para empezar a vigilar tus servicios.";
  } else if (lastIncident === null) {
    story = "Sin incidentes hasta ahora.";
  } else if (lastIncident === undefined) {
    story = "Comprobando el historial de incidentes…";
  } else {
    story = (
      <>
        Último incidente {compactRelative(lastIncident.openedAt)}
        {lastIncident.status === "RESOLVED"
          ? ` — resuelto en ${compactDuration(lastIncident.durationMs)}`
          : ""}
      </>
    );
  }

  const historyTarget =
    state === "incident"
      ? `/w/${workspaceId}/incidents?status=open`
      : state === "empty" && canManageTests
        ? `/w/${workspaceId}/tests/new`
        : state === "empty"
          ? `/w/${workspaceId}/tests`
          : `/w/${workspaceId}/incidents`;
  const historyLabel =
    state === "incident" ? "Ver incidencias" : state === "empty" ? "Empezar" : "Historial";

  return (
    <section
      aria-labelledby="overview-hero-title"
      className="grid min-h-[116px] items-center gap-5 rounded-xl border border-[#e9e9e7] bg-white px-[22px] py-[18px] lg:grid-cols-[minmax(0,1fr)_400px] 2xl:min-h-[136px] 2xl:grid-cols-[minmax(0,1fr)_440px] 2xl:gap-8 2xl:px-7 2xl:py-6"
    >
      <div className="flex min-w-0 items-start gap-2.5 2xl:gap-3">
        <span
          aria-hidden="true"
          className={clsx("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full 2xl:size-11", tone.halo)}
        >
          <span className={clsx("size-2.5 rounded-full 2xl:size-3", tone.dot)} />
        </span>
        <div className="min-w-0">
          <h1
            className="text-lg font-semibold leading-5 tracking-[-0.025em] text-zinc-950 2xl:text-xl 2xl:leading-6"
            id="overview-hero-title"
          >
            {heroHeadline(state, openIncidents)}
          </h1>
          <p className="mt-0.5 text-xs leading-4 text-zinc-500 2xl:text-sm 2xl:leading-5">{story}{state === "calm" ? " ·" : null}</p>
          <Link
            className="text-xs font-semibold leading-4 text-[#463de1] hover:underline 2xl:text-sm 2xl:leading-5"
            to={historyTarget}
          >
            {historyLabel}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[1fr_1.5fr_1fr_1fr] 2xl:gap-5">
        <HeroMetric
          label="Uptime 30 d"
          tone={uptimeTone}
          unit={overview.uptime.uptime30d == null ? undefined : "%"}
          value={metricValue(overview.uptime.uptime30d, 2)}
        />
        <HeroMetric
          label="Resp. 24 h"
          unit={overview.uptime.avgResponseTimeMs24h == null ? undefined : "ms"}
          value={metricValue(
            overview.uptime.avgResponseTimeMs24h == null
              ? null
              : Math.round(overview.uptime.avgResponseTimeMs24h),
          )}
        />
        <HeroMetric
          label="Fallos 24 h"
          tone={overview.browserTests.failed24h > 0 ? "danger" : "neutral"}
          value={overview.browserTests.failed24h}
        />
        <HeroMetric
          label="Incidentes"
          tone={openIncidents > 0 ? "danger" : "neutral"}
          value={openIncidents}
        />
      </div>
    </section>
  );
}
