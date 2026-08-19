import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Member } from "../../api/types";
import { memberActionPolicy, memberColumns } from "./MembersPage";

const owner: Member = {
  email: "owner@example.com",
  joinedAt: "2026-08-19T10:00:00.000Z",
  name: "Owner",
  role: "OWNER",
  userId: "owner_1",
};
const admin: Member = { ...owner, email: "admin@example.com", name: "Admin", role: "ADMIN", userId: "admin_1" };
const member: Member = { ...owner, email: "member@example.com", name: "Member", role: "MEMBER", userId: "member_1" };

describe("members page", () => {
  it("encodes the full owner/admin/member action policy", () => {
    expect(memberActionPolicy("OWNER", owner.userId, owner)).toEqual({
      canChangeRole: false,
      canRemove: false,
    });
    expect(memberActionPolicy("OWNER", owner.userId, admin)).toEqual({
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
    expect(memberActionPolicy("MEMBER", member.userId, member)).toEqual({
      canChangeRole: false,
      canRemove: false,
    });
  });

  it("renders member identity, role, and joined date columns", () => {
    const columns = memberColumns("UTC");
    expect(columns.map((column) => column.key)).toEqual(["member", "role", "joined", "actions"]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(member)}</div>)}</>,
    );
    expect(html).toContain("Member");
    expect(html).toContain("member@example.com");
    expect(html).toContain("19 Aug 2026, 10:00");
  });
});
