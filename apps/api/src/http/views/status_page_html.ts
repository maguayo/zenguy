import { html, raw } from "hono/html";
import type {
  OverallStatus,
  PublicIncidentView,
  PublicStatusItem,
  PublicStatusPageView,
} from "../../application/status_pages/types";

const DEFAULT_ACCENT = "#10b981";
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/iu;

const OVERALL_LABELS: Record<OverallStatus, string> = {
  OPERATIONAL: "All systems operational",
  PARTIAL_OUTAGE: "Partial outage",
  MAJOR_OUTAGE: "Major outage",
};

const STATE_LABELS = {
  OPERATIONAL: "Operational",
  DOWN: "Down",
  PENDING: "Pending",
} as const;

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

function formatUtc(timestamp: number): string {
  return `${new Date(timestamp).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function barClass(day: PublicStatusItem["days"][number]): string {
  if (!day.hasData) return "bar nodata";
  if (day.downtimeSeconds >= 3_600) return "bar down";
  if (day.downtimeSeconds > 0) return "bar partial";
  return "bar ok";
}

function barTitle(day: PublicStatusItem["days"][number]): string {
  if (!day.hasData) return `${day.date} — No data`;
  if (day.downtimeSeconds === 0) return `${day.date} — No downtime`;
  return `${day.date} — ${formatDuration(day.downtimeSeconds)} down`;
}

function renderItem(item: PublicStatusItem): ReturnType<typeof html> {
  return html`<article class="item">
    <div class="item-head">
      <h3>${item.displayName}</h3>
      <span class="pill ${item.state.toLowerCase()}">${STATE_LABELS[item.state]}</span>
    </div>
    <div class="bars" aria-hidden="true">${item.days.map(
      (day) => html`<span class="${barClass(day)}" title="${barTitle(day)}"></span>`,
    )}</div>
    <div class="item-foot">
      <span>90 days ago</span>
      <span class="uptime">${
        item.uptimePercent === null ? "No data yet" : `${item.uptimePercent}% uptime`
      }</span>
      <span>Today</span>
    </div>
  </article>`;
}

function renderItems(items: PublicStatusItem[]): ReturnType<typeof html> {
  const ungrouped = items.filter((item) => item.groupName === null);
  const groups: { name: string; items: PublicStatusItem[] }[] = [];
  for (const item of items) {
    if (item.groupName === null) continue;
    const group = groups.find((entry) => entry.name === item.groupName);
    if (group === undefined) {
      groups.push({ name: item.groupName, items: [item] });
    } else {
      group.items.push(item);
    }
  }
  return html`${ungrouped.map(renderItem)}${groups.map(
    (group) =>
      html`<section class="group">
        <h2>${group.name}</h2>
        ${group.items.map(renderItem)}
      </section>`,
  )}`;
}

function renderIncident(incident: PublicIncidentView): ReturnType<typeof html> {
  const range =
    incident.resolvedAt === null
      ? `Since ${formatUtc(incident.startedAt)}`
      : `${formatUtc(incident.startedAt)} → ${formatUtc(incident.resolvedAt)}`;
  return html`<article class="incident">
    <div class="incident-head">
      <h3>${incident.displayName}</h3>
      <span class="pill ${incident.status === "ONGOING" ? "down" : "resolved"}">
        ${incident.status === "ONGOING" ? "Ongoing" : "Resolved"}
      </span>
    </div>
    <p class="incident-when">${range} · ${formatDuration(incident.durationSeconds)}</p>
    ${incident.updates.map(
      (update) =>
        html`<div class="update">
          <p>${update.message}</p>
          <time>${formatUtc(update.createdAt)}</time>
        </div>`,
    )}
  </article>`;
}

function styles(accent: string, theme: PublicStatusPageView["theme"]): string {
  const light = `
    --bg: #fafaf9; --card: #ffffff; --text: #1c1917; --muted: #78716c;
    --border: #e7e5e4; --ok: ${accent}; --down: #dc2626; --partial: #f59e0b;
    --nodata: #e7e5e4;`;
  const dark = `
    --bg: #0c0a09; --card: #1c1917; --text: #fafaf9; --muted: #a8a29e;
    --border: #292524; --ok: ${accent}; --down: #ef4444; --partial: #fbbf24;
    --nodata: #292524;`;
  const themeBlock =
    theme === "DARK"
      ? `:root { ${dark} }`
      : theme === "LIGHT"
        ? `:root { ${light} }`
        : `:root { ${light} }
           @media (prefers-color-scheme: dark) { :root { ${dark} } }`;
  return `
    ${themeBlock}
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text);
      font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 40px 20px 64px; }
    header h1 { font-size: 24px; margin: 0 0 4px; }
    header p { color: var(--muted); margin: 0 0 24px; }
    .banner { border-radius: 10px; padding: 14px 18px; font-weight: 600;
      color: #fff; margin-bottom: 28px; }
    .banner.operational { background: var(--ok); }
    .banner.partial_outage { background: var(--partial); }
    .banner.major_outage { background: var(--down); }
    .group > h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--muted); margin: 28px 0 4px; }
    .item { background: var(--card); border: 1px solid var(--border);
      border-radius: 10px; padding: 16px 18px; margin: 12px 0; }
    .item-head, .incident-head { display: flex; align-items: center;
      justify-content: space-between; gap: 12px; }
    .item h3, .incident h3 { margin: 0; font-size: 15px; }
    .pill { font-size: 12px; font-weight: 600; padding: 2px 10px;
      border-radius: 999px; color: #fff; background: var(--muted); white-space: nowrap; }
    .pill.operational { background: var(--ok); }
    .pill.down { background: var(--down); }
    .pill.pending { background: var(--muted); }
    .pill.resolved { background: var(--ok); }
    .bars { display: flex; gap: 2px; margin: 14px 0 6px; }
    .bar { flex: 1 1 0; height: 28px; border-radius: 2px; background: var(--ok);
      min-width: 2px; }
    .bar.partial { background: var(--partial); }
    .bar.down { background: var(--down); }
    .bar.nodata { background: var(--nodata); }
    .item-foot { display: flex; justify-content: space-between; color: var(--muted);
      font-size: 12px; }
    .incidents h2 { font-size: 17px; margin: 36px 0 8px; }
    .incident { background: var(--card); border: 1px solid var(--border);
      border-radius: 10px; padding: 16px 18px; margin: 12px 0; }
    .incident-when { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
    .update { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 10px; }
    .update p { margin: 0 0 2px; white-space: pre-wrap; }
    .update time { color: var(--muted); font-size: 12px; }
    .empty { color: var(--muted); }
    footer { margin-top: 40px; display: flex; justify-content: space-between;
      color: var(--muted); font-size: 12px; }
    footer a { color: var(--muted); }
  `;
}

function htmlToString(value: ReturnType<typeof html>): string {
  // Nothing async is ever interpolated into these templates.
  if (value instanceof Promise) throw new Error("unexpected async template");
  return value.toString();
}

export interface RenderStatusPageOptions {
  canonicalUrl: string;
  preview: boolean;
}

export function renderStatusPage(
  view: PublicStatusPageView,
  options: RenderStatusPageOptions,
): string {
  const accent =
    view.accentColor !== null && ACCENT_PATTERN.test(view.accentColor)
      ? view.accentColor
      : DEFAULT_ACCENT;
  const overallLabel = OVERALL_LABELS[view.overall];
  const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${options.preview ? raw("") : raw('<meta http-equiv="refresh" content="60">')}
<title>${view.title}</title>
<link rel="canonical" href="${options.canonicalUrl}">
<meta property="og:title" content="${view.title}">
<meta property="og:description" content="${overallLabel}">
<meta property="og:url" content="${options.canonicalUrl}">
<meta property="og:type" content="website">
<style>${raw(styles(accent, view.theme))}</style>
</head>
<body>
<main>
  <header>
    <h1>${view.title}</h1>
    ${view.description === null ? raw("") : html`<p>${view.description}</p>`}
  </header>
  <div class="banner ${view.overall.toLowerCase()}">${overallLabel}</div>
  ${renderItems(view.items)}
  <section class="incidents">
    <h2>Incidents</h2>
    ${
      view.incidents.length === 0
        ? html`<p class="empty">No incidents in the last 15 days.</p>`
        : html`${view.incidents.map(renderIncident)}`
    }
  </section>
  <footer>
    <span>Updated ${formatUtc(view.generatedAt)}</span>
    <a href="https://zenguy.com?utm_source=status_page" rel="noopener">Powered by Zenguy</a>
  </footer>
</main>
</body>
</html>`;
  return htmlToString(document);
}

export function renderStatusPageNotFound(): string {
  const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Status page not found</title>
<style>${raw(styles(DEFAULT_ACCENT, "SYSTEM"))}</style>
</head>
<body>
<main>
  <header><h1>Status page not found</h1></header>
  <p class="empty">There is no status page at this address.</p>
  <footer>
    <span></span>
    <a href="https://zenguy.com?utm_source=status_page" rel="noopener">Powered by Zenguy</a>
  </footer>
</main>
</body>
</html>`;
  return htmlToString(document);
}
