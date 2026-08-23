import { describe, expect, it } from "vitest";

import { pendingVerificationSchema } from "./VerifyPending";

describe("pending verification form", () => {
  it("accepts only a valid resend address", () => {
    expect(pendingVerificationSchema.safeParse({ email: "invalid" }).success).toBe(
      false,
    );
    expect(
      pendingVerificationSchema.safeParse({ email: "alice@example.com" })
        .success,
    ).toBe(true);
  });
});
