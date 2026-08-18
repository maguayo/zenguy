import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { AuditEntry } from "../../domain/audit/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1AuditRepo } from "./audit_repo";

function audit(
  id: string,
  createdAt: number,
  workspaceId = "ws_primary",
): AuditEntry {
  return {
    id,
    workspaceId,
    actorUserId: "usr_actor",
    action: AUDIT_ACTIONS.workspaceUpdated,
    resourceType: "workspace",
    resourceId: workspaceId,
    metadataJson: '{"name":"New name"}',
    ip: "203.0.113.9",
    createdAt,
  };
}

describe("D1AuditRepo", () => {
  let repo: D1AuditRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1AuditRepo(testEnv().DB);
  });

  it("round-trips every audit field", async () => {
    const entry = audit("aud_entry", 1_000);

    await repo.insert(entry);

    await expect(repo.list(entry.workspaceId, null, 10)).resolves.toEqual([
      entry,
    ]);
  });

  it("orders and paginates by created time then id within a workspace", async () => {
    const oldest = audit("aud_a", 1_000);
    const sameTimeLaterId = audit("aud_b", 1_000);
    const newest = audit("aud_c", 2_000);
    await repo.insert(oldest);
    await repo.insert(sameTimeLaterId);
    await repo.insert(newest);
    await repo.insert(audit("aud_other", 3_000, "ws_other"));

    const firstPage = await repo.list("ws_primary", null, 2);
    expect(firstPage).toEqual([newest, sameTimeLaterId]);
    await expect(
      repo.list(
        "ws_primary",
        {
          createdAt: sameTimeLaterId.createdAt,
          id: sameTimeLaterId.id,
        },
        2,
      ),
    ).resolves.toEqual([oldest]);
  });
});
