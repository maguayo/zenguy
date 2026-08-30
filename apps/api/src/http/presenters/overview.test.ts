import { describe, expect, it } from "vitest";

import type { Overview } from "../../application/overview/get_overview";
import { presentOverview } from "./overview";

const overview: Overview = {
  activity: [],
  browserTests: {
    failed24h: 0,
    openIncidents: 0,
    runningRuns: 0,
    total: 0,
  },
  running: [],
  uptime: {
    avgResponseTimeMs24h: null,
    down: 0,
    openIncidents: 0,
    unknown: 0,
    up: 0,
    uptime30d: null,
  },
  usage: {
    billableRuns: 0,
    currency: "EUR",
    includedRuns: 300,
    overageAmountCents: 0,
    overageRuns: 0,
    periodEnd: Date.parse("2026-09-01T00:00:00.000Z"),
    periodStart: Date.parse("2026-08-01T00:00:00.000Z"),
    projectedTotalCents: 0,
    remainingRuns: 300,
  },
};

describe("presentOverview", () => {
  it.each([
    [0, 3_900],
    [3_900, 3_900],
    [4_900, 4_900],
  ])(
    "floors a %i-cent projection at the monthly plan price",
    (projectedTotalCents, expected) => {
      const result = presentOverview({
        ...overview,
        usage: { ...overview.usage, projectedTotalCents },
      });

      expect(result.usage).toMatchObject({
        periodEnd: "2026-09-01T00:00:00.000Z",
        periodStart: "2026-08-01T00:00:00.000Z",
        projectedTotalCents: expected,
      });
    },
  );
});
