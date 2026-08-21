import { describe, expect, it } from "@jest/globals";

import { ApiError } from "@/lib/api";
import { defaultGrantWorkspaceName, grantLinkState, issuedGrantSummary } from "./grants";

const grant = { expiresAt: "2026-09-18T00:00:00.000Z", status: "valid" as const };
const now = new Date("2026-08-19T10:00:00.000Z").getTime();

describe("complimentary links", () => {
  it("classifies the redeem link state", () => {
    expect(grantLinkState({ error: null, grant: undefined, now, pending: true, token: null })).toBe(
      "unavailable",
    );
    expect(
      grantLinkState({
        error: new ApiError("gone", { code: "GONE", status: 410 }),
        grant: undefined,
        now,
        pending: false,
        token: "tok",
      }),
    ).toBe("unavailable");
    expect(
      grantLinkState({ error: new Error("boom"), grant: undefined, now, pending: false, token: "tok" }),
    ).toBe("error");
    expect(grantLinkState({ error: null, grant: undefined, now, pending: true, token: "tok" })).toBe(
      "loading",
    );
    expect(grantLinkState({ error: null, grant, now, pending: false, token: "tok" })).toBe("valid");
    expect(
      grantLinkState({
        error: null,
        grant: { ...grant, expiresAt: "2026-08-01T00:00:00.000Z" },
        now,
        pending: false,
        token: "tok",
      }),
    ).toBe("expired");
  });

  it("suggests a workspace name from the first name", () => {
    expect(defaultGrantWorkspaceName({ name: "Ada Lovelace" })).toBe("Ada's Workspace");
    expect(defaultGrantWorkspaceName({ name: "   " })).toBe("My's Workspace");
    expect(defaultGrantWorkspaceName(null)).toBe("My Workspace");
  });

  it("summarises issued links in UTC", () => {
    const issued = {
      createdAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-09-18T00:00:00.000Z",
      id: "sgr_1",
      note: "friend",
      redeemedAt: null,
      redeemedWorkspaceId: null,
    };
    expect(issuedGrantSummary(issued)).toBe("Expires 18 Sept 2026, 00:00");
    expect(
      issuedGrantSummary({ ...issued, redeemedAt: "2026-08-20T10:30:00.000Z", redeemedWorkspaceId: "ws_1" }),
    ).toBe("Used 20 Aug 2026, 10:30");
  });
});
