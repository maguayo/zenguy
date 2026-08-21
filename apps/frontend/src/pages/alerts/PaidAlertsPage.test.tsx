import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AlertsOverview, CreditEntry } from "../../api/types";
import { formatEuros } from "../../lib/format";
import { alertsTabPath } from "./AlertsTabs";
import {
  entryPresentation,
  packOptions,
  pollUntilCredited,
  pricingColumns,
  pricingRows,
  statusCopy,
  topUpCopy,
} from "./PaidAlertsPage";

const overview: AlertsOverview = {
  credit: {
    balanceCents: 482,
    currency: "EUR",
    lowBalance: false,
    lowBalanceThresholdCents: 200,
    paidAlertsLast24h: 3,
  },
  destinations: [
    { channels: 2, iso: "ES", name: "Spain" },
    { channels: 1, iso: null, name: "Mexico" },
  ],
  pricing: {
    capturedOn: "2026-08-21",
    currency: "EUR",
    markup: 2,
    regions: [
      {
        countries: [
          { callCents: 20, iso: "US", name: "United States", region: "US_CA", smsCents: 5 },
        ],
        flat: null,
        key: "US_CA",
        name: "United States & Canada",
      },
      {
        countries: [
          { callCents: 20, iso: "ES", name: "Spain", region: "EUROPE", smsCents: 18 },
          { callCents: 56, iso: "NL", name: "Netherlands", region: "EUROPE", smsCents: 23 },
        ],
        flat: null,
        key: "EUROPE",
        name: "Europe",
      },
      { countries: [], flat: { callCents: 80, smsCents: 40 }, key: "ROW", name: "Everywhere else" },
    ],
  },
  settings: { dailyPaidAlertLimit: 20, paidChannelsEnabled: true },
  status: { paidAlertsPaused: false, paidChannelCount: 3, pauseReason: null },
  topUp: { available: true, maxPacks: 3, minPacks: 1, packCents: 1_000 },
};

describe("SMS & calls page", () => {
  it("describes the add-on state for on, off, and no-credit", () => {
    expect(statusCopy(overview)).toMatchObject({ label: "On", tone: "ok" });
    expect(
      statusCopy({
        ...overview,
        settings: { ...overview.settings, paidChannelsEnabled: false },
      }),
    ).toMatchObject({ label: "Off", tone: "neutral" });
    expect(
      statusCopy({
        ...overview,
        status: { paidAlertsPaused: true, paidChannelCount: 3, pauseReason: "NO_CREDIT" },
      }),
    ).toMatchObject({ label: "Paused — no credit", tone: "danger" });
  });

  it("explains when top-ups are not open yet and lists pack sizes", () => {
    expect(topUpCopy(overview)).toBeNull();
    expect(
      topUpCopy({ ...overview, topUp: { ...overview.topUp, available: false } }),
    ).toContain("Top-ups aren't available yet");
    expect(packOptions(overview)).toEqual([1, 2, 3]);
  });

  it("flattens pricing by region and highlights configured destinations", () => {
    const rows = pricingRows(overview.pricing, overview.destinations);
    expect(rows.map((row) => [row.key, row.region, row.channels])).toEqual([
      ["US", "United States & Canada", 0],
      ["ES", "Europe", 2],
      ["NL", "Europe", 0],
      ["ROW", "Everywhere else", 1],
    ]);
    const html = renderToStaticMarkup(
      <>
        {pricingColumns().map((column) => (
          <div key={column.key}>{column.render(rows[1]!)}</div>
        ))}
      </>,
    );
    expect(html).toContain("Spain");
    expect(html).toContain("2 channels");
    expect(html).toContain("0,18");
    expect(html).toContain("0,20");
  });

  it("presents ledger entries with signed amounts", () => {
    const charge: CreditEntry = {
      amountCents: -18,
      balanceAfterCents: 482,
      createdAt: "2026-08-22T10:00:00.000Z",
      deliveryId: "del_1",
      description: "SMS to Spain",
      id: "ace_1",
      kind: "CHARGE",
    };
    expect(entryPresentation(charge)).toEqual({
      amount: `−${formatEuros(18)}`,
      kind: "Alert",
      tone: "negative",
    });
    expect(
      entryPresentation({ ...charge, amountCents: 1_000, kind: "TOPUP" }),
    ).toMatchObject({ amount: `+${formatEuros(1_000)}`, kind: "Top-up", tone: "positive" });
  });

  it("polls the overview until the balance grows, then gives up", async () => {
    const fetchOverview = vi
      .fn<() => Promise<AlertsOverview>>()
      .mockResolvedValueOnce(overview)
      .mockResolvedValueOnce({
        ...overview,
        credit: { ...overview.credit!, balanceCents: 1_482 },
      });
    await expect(
      pollUntilCredited(fetchOverview, 482, { wait: async () => undefined }),
    ).resolves.toBe(true);
    expect(fetchOverview).toHaveBeenCalledTimes(2);

    const stuck = vi.fn<() => Promise<AlertsOverview>>().mockResolvedValue(overview);
    await expect(
      pollUntilCredited(stuck, 482, { maxChecks: 3, wait: async () => undefined }),
    ).resolves.toBe(false);
    expect(stuck).toHaveBeenCalledTimes(3);
  });

  it("builds tab paths", () => {
    expect(alertsTabPath("ws_1", "channels")).toBe("/w/ws_1/alerts");
    expect(alertsTabPath("ws_1", "sms-calls")).toBe("/w/ws_1/alerts/sms-calls");
  });
});
