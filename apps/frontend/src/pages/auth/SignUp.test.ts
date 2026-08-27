import { describe, expect, it } from "vitest";

import { signUpSchema } from "./SignUp";

describe("sign-up schema", () => {
  const valid = {
    acceptedPrivacy: true,
    acceptedTerms: true,
    confirmPassword: "Correct-horse-battery!",
    email: "maria@example.com",
    marketingOptIn: false,
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

  it("requires separate terms and privacy checkboxes, and allows marketing to stay off", () => {
    const terms = signUpSchema.safeParse({ ...valid, acceptedTerms: false });
    expect(terms.success).toBe(false);
    if (!terms.success) {
      expect(terms.error.issues.map((issue) => issue.message)).toContain(
        "You must accept the Terms of Service.",
      );
    }
    const privacy = signUpSchema.safeParse({ ...valid, acceptedPrivacy: false });
    expect(privacy.success).toBe(false);
    if (!privacy.success) {
      expect(privacy.error.issues.map((issue) => issue.message)).toContain(
        "You must confirm that you have read the Privacy Policy.",
      );
    }
    expect(signUpSchema.safeParse({ ...valid, marketingOptIn: true }).success).toBe(
      true,
    );
  });
});
