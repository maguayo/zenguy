import { describe, expect, it } from "@jest/globals";

import { ApiError } from "@/lib/api";
import {
  invitationSentMessage,
  inviteDefaults,
  inviteErrorPresentation,
  inviteInput,
  inviteRoleOptions,
  inviteSchema,
} from "./invite-form";

describe("invite form", () => {
  it("requires a valid email and an assignable role", () => {
    expect(inviteSchema.safeParse({ email: "teammate@example.com", role: "MEMBER" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "teammate@example.com", role: "ADMIN" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "teammate@example.com", role: "OWNER" }).success).toBe(false);

    const invalid = inviteSchema.safeParse({ email: "not-an-email", role: "MEMBER" });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["email", "Enter a valid email address."],
    ]);
    expect(inviteSchema.safeParse(inviteDefaults()).success).toBe(false);
  });

  it("normalises the address before sending and echoes it in the toast", () => {
    expect(inviteInput({ email: "  Teammate@Example.com ", role: "ADMIN" })).toEqual({
      email: "teammate@example.com",
      role: "ADMIN",
    });
    expect(invitationSentMessage("teammate@example.com")).toBe("Invitation sent to teammate@example.com");
    expect(inviteDefaults()).toEqual({ email: "", role: "MEMBER" });
  });

  it("offers the Admin role only to actors who manage admins", () => {
    expect(inviteRoleOptions(false)).toEqual([{ label: "Member", value: "MEMBER" }]);
    expect(inviteRoleOptions(true)).toEqual([
      { label: "Member", value: "MEMBER" },
      { label: "Admin", value: "ADMIN" },
    ]);
  });

  it("explains conflicts on the email field and rate limits on the form", () => {
    expect(inviteErrorPresentation(new ApiError("Conflict", { code: "CONFLICT", status: 409 }))).toEqual({
      field: "email",
      message: "Already a member.",
    });
    expect(
      inviteErrorPresentation(new ApiError("Too many requests", { code: "RATE_LIMITED", status: 429 })),
    ).toEqual({ field: "root", message: "Too many invitations sent. Try again in a moment." });
    expect(inviteErrorPresentation(new ApiError("Forbidden", { code: "FORBIDDEN", status: 403 }))).toBeNull();
    expect(inviteErrorPresentation(new Error("offline"))).toBeNull();
  });
});
