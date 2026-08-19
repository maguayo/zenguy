import { afterEach, describe, expect, it, vi } from "vitest";

import type { Invitation, Member } from "./types";
import {
  changeRole,
  invitationPath,
  invite,
  listInvitations,
  listMembers,
  memberPath,
  removeMember,
  revokeInvitation,
} from "./members";

const member: Member = {
  email: "member@example.com",
  joinedAt: "2026-08-19T10:00:00.000Z",
  name: "Team Member",
  role: "MEMBER",
  userId: "user_1",
};

const invitation: Invitation = {
  createdAt: "2026-08-19T10:00:00.000Z",
  email: "invitee@example.com",
  expiresAt: "2026-08-26T10:00:00.000Z",
  id: "invitation_1",
  invitedBy: { name: "Owner", userId: "owner_1" },
  role: "MEMBER",
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("members API", () => {
  it("encodes member and invitation paths", () => {
    expect(memberPath("ws/one", "user two")).toBe(
      "/api/workspaces/ws%2Fone/members/user%20two",
    );
    expect(invitationPath("ws/one", "invite two")).toBe(
      "/api/workspaces/ws%2Fone/invitations/invite%20two",
    );
  });

  it("exposes all member and invitation operations", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, options?: RequestInit) => {
      const path = String(request);
      if (options?.method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/members") && (!options?.method || options.method === "GET")) {
        return response([member]);
      }
      if (path.endsWith("/invitations") && (!options?.method || options.method === "GET")) {
        return response([invitation]);
      }
      if (options?.method === "PATCH") return response({ ...member, role: "ADMIN" });
      return response(invitation);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listMembers("ws_1")).resolves.toEqual([member]);
    await expect(changeRole("ws_1", "user_1", "ADMIN")).resolves.toMatchObject({
      role: "ADMIN",
    });
    await expect(removeMember("ws_1", "user_1")).resolves.toBeUndefined();
    await expect(listInvitations("ws_1")).resolves.toEqual([invitation]);
    await expect(
      invite("ws_1", { email: "invitee@example.com", role: "MEMBER" }),
    ).resolves.toEqual(invitation);
    await expect(revokeInvitation("ws_1", "invitation_1")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET",
      "PATCH",
      "DELETE",
      "GET",
      "POST",
      "DELETE",
    ]);
  });
});
