import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuditEntry, Workspace } from "./types";
import {
  auditLogsPath,
  deleteWorkspace,
  listAuditLogs,
  transferOwnership,
  updateWorkspace,
} from "./workspaces";

const workspace: Workspace = {
  createdAt: "2026-08-19T10:00:00.000Z",
  id: "ws_1",
  name: "Acme",
  role: "OWNER",
  slug: "acme",
  subscriptionStatus: "ACTIVE",
  timezone: "Europe/Madrid",
};

const auditEntry: AuditEntry = {
  action: "workspace.updated",
  actor: { name: "Ada", userId: "user_1" },
  createdAt: "2026-08-19T10:00:00.000Z",
  id: "audit_1",
  ip: null,
  metadata: { name: "Acme" },
  resourceId: "ws_1",
  resourceType: "workspace",
};

function response(data: unknown, nextCursor?: string | null): Response {
  return new Response(JSON.stringify({ data, nextCursor }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("workspace settings API", () => {
  it("builds an encoded, paginated audit path", () => {
    expect(auditLogsPath("ws/one", "cursor two", 25)).toBe(
      "/api/workspaces/ws%2Fone/audit-logs?limit=25&cursor=cursor+two",
    );
  });

  it("updates, transfers, deletes, and lists audit entries with exact payloads", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === "DELETE") return new Response(null, { status: 204 });
      if (String(request).includes("audit-logs")) {
        return response([auditEntry], "next_cursor");
      }
      if (String(request).endsWith("transfer-ownership")) return response({ ok: true });
      return response({ ...workspace, name: "Renamed" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateWorkspace("ws/one", { name: "Renamed", timezone: "UTC" }),
    ).resolves.toMatchObject({ name: "Renamed" });
    await expect(transferOwnership("ws/one", "user two")).resolves.toEqual({ ok: true });
    await expect(deleteWorkspace("ws/one", "Acme")).resolves.toBeUndefined();
    await expect(listAuditLogs("ws/one", "cursor two")).resolves.toEqual({
      items: [auditEntry],
      nextCursor: "next_cursor",
    });

    expect(fetchMock.mock.calls.map(([request, options]) => [
      String(request),
      options?.method,
      options?.body,
    ])).toEqual([
      [
        "/api/workspaces/ws%2Fone",
        "PATCH",
        JSON.stringify({ name: "Renamed", timezone: "UTC" }),
      ],
      [
        "/api/workspaces/ws%2Fone/transfer-ownership",
        "POST",
        JSON.stringify({ newOwnerUserId: "user two" }),
      ],
      ["/api/workspaces/ws%2Fone", "DELETE", JSON.stringify({ confirmName: "Acme" })],
      [
        "/api/workspaces/ws%2Fone/audit-logs?limit=25&cursor=cursor+two",
        "GET",
        undefined,
      ],
    ]);
  });
});
