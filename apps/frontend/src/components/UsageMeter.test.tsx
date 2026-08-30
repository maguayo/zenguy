import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Usage } from "../api/types";
import { UsageMeter, usageTone } from "./UsageMeter";

const baseUsage: Usage = {
  billableRuns: 12,
  currency: "EUR",
  includedRuns: 300,
  overageAmountCents: 0,
  overageRuns: 0,
  periodEnd: "2026-09-19T10:00:00.000Z",
  periodStart: "2026-08-19T10:00:00.000Z",
  projectedTotalCents: 3900,
  remainingRuns: 288,
};

describe("UsageMeter", () => {
  it("changes tone at 80 percent and in overage", () => {
    expect(usageTone(baseUsage)).toBe("accent");
    expect(usageTone({ ...baseUsage, billableRuns: 240, remainingRuns: 60 })).toBe("warn");
    expect(
      usageTone({
        ...baseUsage,
        billableRuns: 301,
        overageAmountCents: 20,
        overageRuns: 1,
        remainingRuns: 0,
      }),
    ).toBe("danger");
  });

  it("renders accessible usage details and hides zero overage", () => {
    const html = renderToStaticMarkup(
      <UsageMeter
        timezone="Europe/Madrid"
        usage={{
          ...baseUsage,
          periodEnd: "2026-09-01T00:00:00.000Z",
        }}
      />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain("12 of 300 runs used");
    expect(html).toContain(
      "Projected total 39,00 € · resets 01 Sept 2026, 02:00",
    );
    expect(html).not.toContain("Extra runs");
  });

  it("shows overage rows when extra runs exist", () => {
    const html = renderToStaticMarkup(
      <UsageMeter
        timezone="Europe/Madrid"
        usage={{
          ...baseUsage,
          billableRuns: 302,
          overageAmountCents: 40,
          overageRuns: 2,
          remainingRuns: 0,
        }}
      />,
    );
    expect(html).toContain("Extra runs");
    expect(html).toContain("Extra cost");
  });

  it("formats USD projections and overage without changing alert-credit formatting", () => {
    const html = renderToStaticMarkup(
      <UsageMeter
        timezone="UTC"
        usage={{
          ...baseUsage,
          billableRuns: 302,
          currency: "USD",
          overageAmountCents: 40,
          overageRuns: 2,
          projectedTotalCents: 3_940,
          remainingRuns: 0,
        }}
      />,
    );
    expect(html).toContain("Extra cost");
    expect(html).toContain("$0.40");
    expect(html).toContain("Projected total $39.40");
  });
});
