import { describe, expect, it } from "vitest";

import { forgotPasswordSchema } from "./ForgotPassword";
import { resetPasswordSchema } from "./ResetPassword";
import { verificationEmailSchema } from "./VerifyEmail";

describe("email-link auth schemas", () => {
  it("validates email addresses for forgot and resend flows", () => {
    expect(forgotPasswordSchema.safeParse({ email: "invalid" }).success).toBe(false);
    expect(
      verificationEmailSchema.safeParse({ email: "maria@example.com" }).success,
    ).toBe(true);
  });

  it("requires a strong matching reset password", () => {
    expect(
      resetPasswordSchema.safeParse({
        confirmPassword: "Password123!",
        password: "Password123!",
      }).success,
    ).toBe(true);
    const result = resetPasswordSchema.safeParse({
      confirmPassword: "different",
      password: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        "Password must be at least 8 characters.",
        "Passwords don't match.",
      ]);
    }
  });
});
