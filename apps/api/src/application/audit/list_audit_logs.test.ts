import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { AuditEntry } from "../../domain/audit/types";
import type { User } from "../../domain/users/types";
import { FakeAuditRepo, FakeUserRepo } from "../../test/fakes/repos";
import { ListAuditLogs } from "./list_audit_logs";

const ACTOR: User = {
  id: "usr_audit_actor",
  name: "Audit Actor",
  email: "actor@audit.test",
  passwordHash: "unused",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

function entry(
  id: string,
  createdAt: number,
  actorUserId: string | null = ACTOR.id,
): AuditEntry {
  return {
    id,
    workspaceId: "ws_audit",
    actorUserId,
    action: AUDIT_ACTIONS.workspaceUpdated,
    resourceType: "WORKSPACE",
    resourceId: "ws_audit",
    metadataJson: JSON.stringify({ name: `Name ${id}`, count: 2 }),
    ip: "203.0.113.7",
    createdAt,
  };
}

describe("ListAuditLogs", () => {
  it("hydrates actors, parses metadata, and paginates with a keyset", async () => {
    const audits = new FakeAuditRepo();
    const users = new FakeUserRepo();
    await users.insert(ACTOR);
    await audits.insert(entry("aud_c", 2_000));
    await audits.insert(entry("aud_b", 2_000, null));
    await audits.insert(entry("aud_a", 1_000, "usr_deleted"));
    const service = new ListAuditLogs(audits, users);

    const first = await service.execute({ workspaceId: "ws_audit", limit: 2 });

    expect(first.auditLogs).toEqual([
      {
        id: "aud_c",
        action: "workspace.updated",
        actor: { userId: ACTOR.id, name: ACTOR.name },
        resourceType: "WORKSPACE",
        resourceId: "ws_audit",
        metadata: { name: "Name aud_c", count: 2 },
        ip: "203.0.113.7",
        createdAt: 2_000,
      },
      expect.objectContaining({ id: "aud_b", actor: null }),
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.execute({
      workspaceId: "ws_audit",
      cursor: first.nextCursor as string,
      limit: 2,
    });
    expect(second).toEqual({
      auditLogs: [expect.objectContaining({ id: "aud_a", actor: null })],
      nextCursor: null,
    });
  });

  it("rejects invalid limits and treats malformed metadata as null", async () => {
    const audits = new FakeAuditRepo();
    const malformed = entry("aud_malformed", 1_000);
    malformed.metadataJson = "not-json";
    await audits.insert(malformed);
    const service = new ListAuditLogs(audits, new FakeUserRepo());

    await expect(
      service.execute({ workspaceId: "ws_audit", limit: 101 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.execute({ workspaceId: "ws_audit" }),
    ).resolves.toMatchObject({
      auditLogs: [{ id: "aud_malformed", metadata: null }],
    });
  });
});
