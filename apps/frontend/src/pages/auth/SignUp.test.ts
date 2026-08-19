import { describe, expect, it } from "vitest";

import { signUpSchema } from "./SignUp";

describe("sign-up schema", () => {
  const valid = {
    acceptedTerms: true,
    confirmPassword: "Password123!",
    email: "maria@example.com",
    name: "María",
    password: "Password123!",
  };

  it("accepts a complete account", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("requires eight characters and matching confirmation", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      confirmPassword: "different",
      password: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "Password must be at least 8 characters.",
      );
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "Passwords don't match.",
      );
    }
  });

  it("requires terms acceptance", () => {
    const result = signUpSchema.safeParse({ ...valid, acceptedTerms: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "You must accept the Terms and Privacy Policy.",
      );
    }
  });
});
