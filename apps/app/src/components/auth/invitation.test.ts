import { describe, expect, it } from "@jest/globals";

import type { PublicInvitation, User } from "@/api/types";
import { ApiError } from "@/lib/api";
import { invitationAccessMode, invitationRoleLabel } from "./invitation";
import { isExpiredLink } from "./link-errors";

const invitation: PublicInvitation = {
  email: "invitee@example.com",
  expiresAt: "2026-08-26T10:00:00.000Z",
  inviterName: "María",
  role: "MEMBER",
  workspaceName: "Acme",
};

const user: User = {
  createdAt: "2026-08-19T10:00:00.000Z",
  email: "invitee@example.com",
  emailVerified: true,
  id: "usr_1",
  name: "Invitee",
};

describe("invitation access mode", () => {
  it("adapts to signed-out, matching and different accounts", () => {
    expect(invitationAccessMode(invitation, null)).toBe("signedOut");
    expect(invitationAccessMode(invitation, user)).toBe("matching");
    expect(
      invitationAccessMode(invitation, { ...user, email: "other@example.com" }),
    ).toBe("different");
  });

  it("matches email addresses case-insensitively", () => {
    expect(
      invitationAccessMode(invitation, { ...user, email: "INVITEE@EXAMPLE.COM" }),
    ).toBe("matching");
  });

  it("labels roles like the web", () => {
    expect(invitationRoleLabel("ADMIN")).toBe("Admin");
    expect(invitationRoleLabel("MEMBER")).toBe("Member");
  });
});

describe("isExpiredLink", () => {
  it("recognises gone and missing link tokens only", () => {
    expect(isExpiredLink(new ApiError("gone", { code: "GONE", status: 410 }))).toBe(true);
    expect(isExpiredLink(new ApiError("missing", { code: "NOT_FOUND", status: 404 }))).toBe(true);
    expect(isExpiredLink(new ApiError("nope", { code: "FORBIDDEN", status: 403 }))).toBe(false);
    expect(isExpiredLink(new Error("offline"))).toBe(false);
  });
});
