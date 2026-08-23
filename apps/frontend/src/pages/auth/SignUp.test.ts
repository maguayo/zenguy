import { describe, expect, it } from "vitest";

import { signUpSchema } from "./SignUp";

describe("sign-up schema", () => {
  const valid = {
    acceptedTerms: true,
    confirmPassword: "Correct-horse-battery!",
    email: "maria@example.com",
    name: "María",
    password: "Correct-horse-battery!",
  };

  it("accepts a complete account", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("requires fifteen characters and matching confirmation", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      confirmPassword: "different",
      password: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "Password must be at least 15 characters.",
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
