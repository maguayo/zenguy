import { describe, expect, it } from "@jest/globals";

import { ApiError } from "@/lib/api";
import {
  forgotPasswordSchema,
  isResetLinkExpired,
  resetPasswordFormSchema,
  resetPasswordSchema,
  resetTokenMessage,
} from "./password-flows";
import { verificationEmailSchema } from "./verify-email";

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

describe("in-app reset form", () => {
  const passwords = { confirmPassword: "Password123!", password: "Password123!" };

  it("accepts link tokens and pasted tokens with surrounding whitespace", () => {
    expect(resetPasswordFormSchema.safeParse({ ...passwords, token: "abc_-1" }).success).toBe(true);
    expect(resetPasswordFormSchema.safeParse({ ...passwords, token: "  tok3n\n" }).success).toBe(true);
  });

  it("rejects missing or malformed tokens with the paste hint", () => {
    for (const token of ["", "a b", "../etc", "a".repeat(513)]) {
      const result = resetPasswordFormSchema.safeParse({ ...passwords, token });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["token"]);
        expect(result.error.issues[0]?.message).toBe(resetTokenMessage);
      }
    }
  });

  it("keeps the password rules of the web schema", () => {
    const result = resetPasswordFormSchema.safeParse({
      confirmPassword: "different",
      password: "short",
      token: "tok3n",
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

describe("isResetLinkExpired", () => {
  it("treats GONE, 410, 404 and token-related 400s as an expired link", () => {
    expect(isResetLinkExpired(new ApiError("gone", { code: "GONE", status: 410 }))).toBe(true);
    expect(isResetLinkExpired(new ApiError("gone", { code: "NOT_FOUND", status: 404 }))).toBe(true);
    expect(
      isResetLinkExpired(
        new ApiError("bad", {
          code: "VALIDATION_ERROR",
          details: [{ field: "token", message: "Required" }],
          status: 400,
        }),
      ),
    ).toBe(true);
    expect(isResetLinkExpired(new ApiError("bad", { code: "BAD_REQUEST", status: 400 }))).toBe(true);
  });

  it("leaves password validation errors and other failures to the form", () => {
    expect(
      isResetLinkExpired(
        new ApiError("bad", {
          code: "VALIDATION_ERROR",
          details: [{ field: "password", message: "Too weak" }],
          status: 400,
        }),
      ),
    ).toBe(false);
    expect(isResetLinkExpired(new ApiError("down", { code: "INTERNAL", status: 500 }))).toBe(false);
    expect(isResetLinkExpired(new Error("offline"))).toBe(false);
  });
});
