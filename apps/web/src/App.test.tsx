import { describe, expect, it } from "vitest";

import { shouldRetryQuery } from "./App";
import { ApiError } from "./lib/api";

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
});
