import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Metrics } from "../../shared/types";
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
  });

  it("keeps the danger widget neutral at zero", () => {
    const html = renderToStaticMarkup(
      <UsersHero users={{ ...metrics.users, danger: 0 }} />,
    );
    expect(html).not.toContain("text-danger-700");
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
