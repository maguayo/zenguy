import { describe, expect, it } from "@jest/globals";

import { ApiError } from "@/lib/api";
import { mutationErrorPresentation } from "./useMutationError";

describe("mutationErrorPresentation", () => {
  it("maps forbidden and billing errors and ignores the rest", () => {
    expect(
      mutationErrorPresentation(new ApiError("no", { code: "FORBIDDEN", status: 403 })),
    ).toEqual({ message: "You don't have permission to do that.", redirectToBilling: false });
    expect(
      mutationErrorPresentation(new ApiError("pay", { code: "BILLING_REQUIRED", status: 402 })),
    ).toMatchObject({ redirectToBilling: true });
    expect(mutationErrorPresentation(new ApiError("x", { code: "CONFLICT", status: 409 }))).toBeNull();
    expect(mutationErrorPresentation(new Error("boom"))).toBeNull();
  });
});
