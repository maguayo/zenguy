import { afterEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "./types";
import {
  complimentaryWorkspaces,
  getSubscriptionGrant,
  issueSubscriptionGrant,
  redeemSubscriptionGrant,
} from "./grants";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const workspace = (id: string, subscriptionStatus: Workspace["subscriptionStatus"]): Workspace => ({
  createdAt: "2026-08-19T10:00:00.000Z",
  id,
  name: id,
  role: "OWNER",
  slug: id,
  subscriptionStatus,
  timezone: "UTC",
});

afterEach(() => vi.unstubAllGlobals());

describe("subscription grant API", () => {
  it("loads, issues, and redeems a one-time grant link", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/subscription-grants/preview")) {
        return response({ expiresAt: "2026-09-18T00:00:00.000Z", status: "valid" });
      }
      if (path.endsWith("/redeem")) {
        return response({ subscriptionStatus: "ACTIVE", workspaceId: "ws_1" });
      }
      return response({
        createdAt: "2026-08-19T00:00:00.000Z",
        expiresAt: "2026-09-18T00:00:00.000Z",
        id: "sgr_1",
        note: "friend",
        redeemUrl: "https://app.zenguy.com/grants/redeem#abc",
        token: "abc",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSubscriptionGrant("tok")).resolves.toMatchObject({ status: "valid" });
    await expect(issueSubscriptionGrant("friend")).resolves.toMatchObject({ token: "abc" });
    await expect(redeemSubscriptionGrant("tok", "ws_1")).resolves.toEqual({
      subscriptionStatus: "ACTIVE",
      workspaceId: "ws_1",
    });
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      "/api/subscription-grants/preview",
      "/api/subscription-grants",
      "/api/subscription-grants/redeem",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ token: "tok" });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      token: "tok",
      workspaceId: "ws_1",
    });
  });

  it("only offers unpaid workspaces for redeem", () => {
    expect(
      complimentaryWorkspaces([
        workspace("ws_active", "ACTIVE"),
        workspace("ws_none", "NONE"),
        workspace("ws_canceled", "CANCELED"),
      ]).map((item) => item.id),
    ).toEqual(["ws_none", "ws_canceled"]);
  });
});
