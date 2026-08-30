import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Costs, Metrics } from "../../shared/types";
import { CostsHero } from "./CostsHero";
import { TestsHero } from "./TestsHero";
import { UptimeHero } from "./UptimeHero";
import { UsersHero } from "./UsersHero";

const metrics: Metrics = {
  range: { days: 7, from: "2026-08-24", to: "2026-08-30", now: 1_787_800_000_000 },
  users: {
    registered: 42,
    newInRange: 3,
    active7d: 17,
    danger: 5,
    series: [{ day: "2026-08-30", signups: 3, cumulative: 42 }],
    productUsage: {
      timezone: "Europe/Madrid",
      overall: {
        dau: 8,
        wau: 17,
        mau: 25,
        dauMau: 0.32,
        activeUsers: 17,
        visits: 68,
        visitsPerActiveUser: 4,
      },
      bySource: {
        web: {
          dau: 6,
          wau: 14,
          mau: 21,
          dauMau: 6 / 21,
          activeUsers: 14,
          visits: 56,
          visitsPerActiveUser: 4,
        },
        app: {
          dau: 3,
          wau: 5,
          mau: 7,
          dauMau: 3 / 7,
          activeUsers: 5,
          visits: 12,
          visitsPerActiveUser: 2.4,
        },
      },
      series: [
        {
          day: "2026-08-30",
          activeUsers: 8,
          webActiveUsers: 6,
          appActiveUsers: 3,
          visits: 18,
          webVisits: 14,
          appVisits: 4,
        },
      ],
    },
  },
  tests: {
    total: 120,
    perUser: 2.5,
    failed2h: 4,
    retries: { first: 90, second: 8, thirdPlus: 2 },
    spendCents: { today: 25, last7d: 250, last30d: 1_300 },
    series: [
      {
        day: "2026-08-30",
        passed: 10,
        failed: 2,
        timeout: 1,
        systemError: 0,
        total: 15,
        avgDurationMs: 2_500,
      },
    ],
  },
  uptime: {
    upPercent: 99.4,
    monitorsDown: 1,
    monitorsTotal: 6,
    openIncidents: 2,
    series: [{ day: "2026-08-30", up: 140, down: 4, avgResponseMs: 210 }],
  },
};

const NOW = 1_787_800_000_000;

const costs: Costs = {
  month: { key: "2026-08", from: "2026-08-01", to: "2026-08-31", daysElapsed: 30, daysInMonth: 31 },
  baseFeeCents: 500,
  totalCents: 590,
  projectedCents: 593,
  topLine: { key: "workers.requests", label: "Workers requests", costCents: 90 },
  lastCollection: {
    id: "col_1",
    source: "cron",
    status: "PARTIAL",
    fromDay: "2026-08-28",
    toDay: "2026-08-30",
    startedAt: NOW - 3_600_000,
    finishedAt: NOW - 3_599_000,
    probes: [
      { probe: "workers", ok: true, rows: 9 },
      { probe: "r2", ok: false, rows: 0, error: "Cannot query field date" },
    ],
  },
  collectorConfigured: true,
  lines: [
    { key: "workers.requests", label: "Workers requests", unit: "M requests", monthToDate: 13, included: 10, overage: 3, unitPriceCents: 30, costCents: 90 },
    { key: "d1.rows_read", label: "D1 rows read", unit: "M rows", monthToDate: 120, included: 25_000, overage: 0, unitPriceCents: 0.1, costCents: 0 },
    { key: "queues.operations", label: "Queues operations", unit: "M ops", monthToDate: 0, included: 1, overage: 0, unitPriceCents: 40, costCents: 0 },
  ],
  series: [
    { day: "2026-08-29", byLine: {}, totalCents: 0 },
    { day: "2026-08-30", byLine: { "workers.requests": 90 }, totalCents: 90 },
  ],
};

const idle = { onRefresh: () => {}, refreshing: false, refreshError: null };

describe("costs hero", () => {
  it("shows the month total, the top line and the last collection with its probes", () => {
    const html = renderToStaticMarkup(<CostsHero costs={costs} now={NOW} {...idle} />);
    expect(html).toContain("Coste estimado (mes)");
    expect(html).toContain("$5.90");
    expect(html).toContain("$5.93"); // projection
    expect(html).toContain("Línea más cara");
    expect(html).toContain("Workers requests");
    expect(html).toContain("$0.90");
    expect(html).toContain("Última recogida");
    expect(html).toContain("1h 0m ago");
    expect(html).toContain("PARTIAL");
    expect(html).toContain("Cannot query field date");
    expect(html).toContain("Coste marginal por día");
  });

  it("lists the lines with usage and hides idle ones", () => {
    const html = renderToStaticMarkup(<CostsHero costs={costs} now={NOW} {...idle} />);
    expect(html).toContain("D1 rows read");
    expect(html).toContain("M rows");
    expect(html).not.toContain("Queues operations");
  });

  it("explains the setup when no analytics token is installed", () => {
    const html = renderToStaticMarkup(
      <CostsHero
        costs={{ ...costs, collectorConfigured: false, lastCollection: null, lines: [], series: [] }}
        now={NOW}
        {...idle}
      />,
    );
    expect(html).toContain("CF_ANALYTICS_API_TOKEN");
    expect(html).toContain("Account Analytics");
    expect(html).not.toContain("Actualizar ahora");
  });

  it("flags a collection older than two days", () => {
    const html = renderToStaticMarkup(
      <CostsHero
        costs={{
          ...costs,
          lastCollection: { ...costs.lastCollection!, startedAt: NOW - 3 * 86_400_000 },
        }}
        now={NOW}
        {...idle}
      />,
    );
    expect(html).toContain("text-danger-700");
  });
});

describe("users hero", () => {
  it("shows the three widgets with their definitions", () => {
    const html = renderToStaticMarkup(<UsersHero users={metrics.users} />);
    expect(html).toContain("Usuarios registrados");
    expect(html).toContain("42");
    expect(html).toContain("+3 en el rango");
    expect(html).toContain("Usuarios activos");
    expect(html).toContain("17");
    expect(html).toContain("Usuarios danger");
    expect(html).toContain("14+ días sin señales");
    expect(html).toContain("Evolución de usuarios");
    expect(html).toContain("Uso autenticado del producto");
    expect(html).toContain("Product DAU");
    expect(html).toContain("Product WAU");
    expect(html).toContain("Product MAU");
    expect(html).toContain("DAU / MAU");
    expect(html).toContain("Visitas / cuenta");
    expect(html).toContain("App nativa");
    expect(html).toContain("Total deduplica las cuentas");
  });

  it("keeps the danger widget neutral at zero", () => {
    const html = renderToStaticMarkup(
      <UsersHero users={{ ...metrics.users, danger: 0 }} />,
    );
    expect(html).not.toContain("text-danger-700");
  });

  it("explains when authenticated usage is waiting for the activity migration", () => {
    const html = renderToStaticMarkup(
      <UsersHero
        users={{ ...metrics.users, productUsage: { unavailable: "MIGRATION_PENDING" } }}
      />,
    );
    expect(html).toContain("Uso autenticado pendiente");
    expect(html).toContain("migración de activity_events");
    expect(html).not.toContain("Product DAU");
  });
});

describe("tests hero", () => {
  it("shows totals, per-user, recent failures, retries and estimated spend", () => {
    const html = renderToStaticMarkup(<TestsHero tests={metrics.tests} />);
    expect(html).toContain("Tests totales");
    expect(html).toContain("120");
    expect(html).toContain("Tests por usuario");
    expect(html).toContain("2.5");
    expect(html).toContain("Fallidos (2h)");
    expect(html).toContain("text-danger-700");
    expect(html).toContain("Reintentos");
    expect(html).toContain("1ª");
    expect(html).toContain("90%"); // 90 of 100 passes on the first attempt
    expect(html).toContain("Gasto estimado");
    expect(html).toContain("$0.25");
    expect(html).toContain("$2.50");
    expect(html).toContain("$13");
  });

  it("dashes per-user when the range had no owners", () => {
    const html = renderToStaticMarkup(
      <TestsHero tests={{ ...metrics.tests, perUser: null }} />,
    );
    expect(html).toContain("—");
  });
});

describe("uptime hero", () => {
  it("shows uptime, down monitors and open incidents", () => {
    const html = renderToStaticMarkup(<UptimeHero uptime={metrics.uptime} />);
    expect(html).toContain("Uptime");
    expect(html).toContain("99%");
    expect(html).toContain("Monitores down");
    expect(html).toContain("de 6 activos");
    expect(html).toContain("Incidentes abiertos");
    expect(html).toContain("Checks por día");
  });

  it("dashes the uptime widget when the range had no checks", () => {
    const html = renderToStaticMarkup(
      <UptimeHero uptime={{ ...metrics.uptime, upPercent: null }} />,
    );
    expect(html).toContain("—");
  });
});
