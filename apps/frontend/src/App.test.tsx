import { describe, expect, it } from "vitest";

import { shouldRetryQuery } from "./App";
import { ApiError } from "./lib/api";
import RedeemGrant from "./pages/billing/RedeemGrant";
import IssueGrants from "./pages/billing/IssueGrants";
import Cookies from "./pages/legal/Cookies";
import LegalNotice from "./pages/legal/LegalNotice";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";

describe("application query policy", () => {
  it("does not retry client-side API errors", () => {
    expect(
      shouldRetryQuery(
        0,
        new ApiError("Forbidden", { code: "FORBIDDEN", status: 403 }),
      ),
    ).toBe(false);
  });

  it("retries server and network errors at most twice", () => {
    expect(
      shouldRetryQuery(
        0,
        new ApiError("Server error", { code: "INTERNAL", status: 500 }),
      ),
    ).toBe(true);
    expect(shouldRetryQuery(1, new Error("Network"))).toBe(true);
    expect(shouldRetryQuery(2, new Error("Network"))).toBe(false);
  });

  it("ships redeem and issue pages for complimentary links", () => {
    expect(RedeemGrant).toEqual(expect.any(Function));
    expect(IssueGrants).toEqual(expect.any(Function));
  });

  it("ships public legal pages", () => {
    expect(Privacy).toEqual(expect.any(Function));
    expect(Terms).toEqual(expect.any(Function));
    expect(LegalNotice).toEqual(expect.any(Function));
    expect(Cookies).toEqual(expect.any(Function));
  });
});
