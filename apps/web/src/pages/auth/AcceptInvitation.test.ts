import { describe, expect, it } from "vitest";

import type { PublicInvitation, User } from "../../api/types";
import { invitationAccessMode } from "./AcceptInvitation";

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
});
