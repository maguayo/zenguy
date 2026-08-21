import { describe, expect, it } from "@jest/globals";

import type { Member } from "@/api/types";
import {
  memberActionPolicy,
  removeMemberTitle,
  roleChangedMessage,
  roleLabel,
} from "./member-policy";

const owner: Member = {
  email: "owner@example.com",
  joinedAt: "2026-08-19T10:00:00.000Z",
  name: "Owner",
  role: "OWNER",
  userId: "owner_1",
};
const admin: Member = { ...owner, email: "admin@example.com", name: "Admin", role: "ADMIN", userId: "admin_1" };
const member: Member = { ...owner, email: "member@example.com", name: "Member", role: "MEMBER", userId: "member_1" };

describe("member action policy", () => {
  it("encodes the full owner/admin/member action policy", () => {
    expect(memberActionPolicy("OWNER", owner.userId, owner)).toEqual({
      canChangeRole: false,
      canRemove: false,
    });
    expect(memberActionPolicy("OWNER", owner.userId, admin)).toEqual({
      canChangeRole: true,
      canRemove: true,
    });
    expect(memberActionPolicy("OWNER", owner.userId, member)).toEqual({
      canChangeRole: true,
      canRemove: true,
    });
    expect(memberActionPolicy("ADMIN", admin.userId, member)).toEqual({
      canChangeRole: false,
      canRemove: true,
    });
    expect(memberActionPolicy("ADMIN", admin.userId, admin)).toEqual({
      canChangeRole: false,
      canRemove: false,
    });
    expect(memberActionPolicy("ADMIN", admin.userId, owner)).toEqual({
      canChangeRole: false,
      canRemove: false,
    });
    expect(memberActionPolicy("MEMBER", member.userId, member)).toEqual({
      canChangeRole: false,
      canRemove: false,
    });
  });

  it("keeps the web's labels, toasts and removal prompt", () => {
    expect(roleLabel).toEqual({ ADMIN: "Admin", MEMBER: "Member", OWNER: "Owner" });
    expect(roleChangedMessage("Ada", "ADMIN")).toBe("Ada is now an Admin");
    expect(roleChangedMessage("Ada", "MEMBER")).toBe("Ada is now a Member");
    expect(removeMemberTitle(member)).toBe("Remove Member from this workspace?");
  });
});
