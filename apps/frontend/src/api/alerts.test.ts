import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alertsPath,
  creditEntriesPath,
  getAlertsOverview,
  listCreditEntries,
  quotePath,
  startCreditTopUp,
  updateAlertSettings,
} from "./alerts";

function response(data: unknown, nextCursor?: string | null): Response {
  return new Response(JSON.stringify({ data, nextCursor }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("alerts API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds workspace-scoped, encoded paths", () => {
    expect(alertsPath("ws 1")).toBe("/api/workspaces/ws%201/alerts");
    expect(creditEntriesPath("ws_1")).toBe(
      "/api/workspaces/ws_1/alerts/credit/entries?limit=25",
    );
    expect(creditEntriesPath("ws_1", { cursor: "abc", limit: 10 })).toBe(
      "/api/workspaces/ws_1/alerts/credit/entries?limit=10&cursor=abc",
    );
    expect(quotePath("ws_1", "+34600123456")).toBe(
      "/api/workspaces/ws_1/alerts/quote?phoneNumber=%2B34600123456",
    );
  });

  it("reads the overview, patches settings, pages the ledger, and starts top-ups", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ settings: { paidChannelsEnabled: false } }))
      .mockResolvedValueOnce(response({ paidChannelsEnabled: true }))
      .mockResolvedValueOnce(response([{ id: "ace_1" }], "next"))
      .mockResolvedValueOnce(response({ priceId: "pri_1", quantity: 2 }));

    await expect(getAlertsOverview("ws_1")).resolves.toEqual({
      settings: { paidChannelsEnabled: false },
    });
    await expect(
      updateAlertSettings("ws_1", { paidChannelsEnabled: true }),
    ).resolves.toEqual({ paidChannelsEnabled: true });
    await expect(listCreditEntries("ws_1", { limit: 5 })).resolves.toEqual({
      items: [{ id: "ace_1" }],
      nextCursor: "next",
    });
    await expect(startCreditTopUp("ws_1", 2)).resolves.toEqual({
      priceId: "pri_1",
      quantity: 2,
    });

    const calls = fetchMock.mock.calls.map(([url, init]) => [
      String(url),
      (init as RequestInit | undefined)?.method ?? "GET",
      (init as RequestInit | undefined)?.body ?? null,
    ]);
    expect(calls).toEqual([
      ["/api/workspaces/ws_1/alerts", "GET", null],
      [
        "/api/workspaces/ws_1/alerts/settings",
        "PATCH",
        JSON.stringify({ paidChannelsEnabled: true }),
      ],
      ["/api/workspaces/ws_1/alerts/credit/entries?limit=5", "GET", null],
      [
        "/api/workspaces/ws_1/alerts/credit/topups",
        "POST",
        JSON.stringify({ packs: 2 }),
      ],
    ]);
  });
});
