import { describe, expect, it } from "vitest";

import {
  verificationEmailSchema,
  verificationPasswordSchema,
} from "./VerifyEmail";

describe("email verification forms", () => {
  it("requires the original registration password", () => {
    expect(verificationPasswordSchema.safeParse({ password: "" }).success).toBe(
      false,
    );
    expect(
      verificationPasswordSchema.safeParse({ password: "historic password" })
        .success,
    ).toBe(true);
  });

  it("still validates the resend address separately", () => {
    expect(verificationEmailSchema.safeParse({ email: "invalid" }).success).toBe(
      false,
    );
    expect(
      verificationEmailSchema.safeParse({ email: "alice@example.com" }).success,
    ).toBe(true);
  });
});
