import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import { mutationErrorPresentation } from "./useMutationError";

describe("shared mutation error presentation", () => {
  it("normalizes forbidden responses to the required permission toast", () => {
    expect(
      mutationErrorPresentation(
        new ApiError("Backend detail", { code: "FORBIDDEN", status: 403 }),
      ),
    ).toEqual({
      message: "You don't have permission to do that.",
      redirectToBilling: false,
    });
  });

  it("sends billing-required responses to setup", () => {
    expect(
      mutationErrorPresentation(
        new ApiError("Subscription required", { code: "BILLING_REQUIRED", status: 402 }),
      ),
    ).toEqual({
      message: "Billing required — set up your subscription first.",
      redirectToBilling: true,
    });
  });

  it("lets feature-specific errors fall through", () => {
    expect(
      mutationErrorPresentation(new ApiError("Conflict", { code: "CONFLICT", status: 409 })),
    ).toBeNull();
    expect(mutationErrorPresentation(new Error("Offline"))).toBeNull();
  });
});
