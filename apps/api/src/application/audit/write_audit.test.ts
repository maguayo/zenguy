import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { AuditRepo } from "../../domain/audit/repo";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakeAuditRepo } from "../../test/fakes/repos";
import { WriteAudit } from "./write_audit";

describe("WriteAudit", () => {
  it("writes safe, bounded metadata and masks sensitive fields", async () => {
    const audits = new FakeAuditRepo();
    const clock = new FixedClock(1_700_000_000_000);
    const writer = new WriteAudit({ audits, clock, ids: new FakeIds() });

    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.memberRoleChanged,
      resourceType: "member",
      resourceId: "usr_target",
      metadata: {
        targetUserId: "usr_target",
        from: "MEMBER",
        to: "ADMIN",
        count: 1,
        changedFields: ["role"],
        password: "must-not-be-stored",
      },
      ip: "203.0.113.5",
    });

    const entry = [...audits.entries.values()][0];
    expect(entry).toMatchObject({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: "member.role_changed",
      resourceType: "member",
      resourceId: "usr_target",
      ip: "203.0.113.5",
      createdAt: clock.now(),
    });
    expect(JSON.parse(entry?.metadataJson ?? "null")).toEqual({
      targetUserId: "usr_target",
      from: "MEMBER",
      to: "ADMIN",
      count: 1,
      changedFields: ["role"],
      password: "***",
    });
  });

  it("caps serialized metadata at 2000 characters", async () => {
    const audits = new FakeAuditRepo();
    const writer = new WriteAudit({
      audits,
      clock: new FixedClock(1),
      ids: new FakeIds(),
    });

    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: null,
      action: AUDIT_ACTIONS.workspaceCreated,
      metadata: { name: "x".repeat(3_000) },
    });

    expect([...audits.entries.values()][0]?.metadataJson).toHaveLength(2_000);
  });

  it("never fails the parent operation when persistence fails", async () => {
    const failingRepo: AuditRepo = {
      insert: async () => {
        throw new Error("database unavailable");
      },
      list: async () => [],
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const writer = new WriteAudit({
      audits: failingRepo,
      clock: new FixedClock(1),
      ids: new FakeIds(),
    });

    await expect(
      writer.execute({
        workspaceId: "ws_primary",
        actorUserId: "usr_actor",
        action: AUDIT_ACTIONS.workspaceUpdated,
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('"event":"audit_write_failed"');
    log.mockRestore();
  });

  it("defines every required audited action", () => {
    expect(Object.values(AUDIT_ACTIONS).sort()).toEqual(
      [
        "workspace.created",
        "workspace.updated",
        "workspace.deleted",
        "workspace.ownership_transferred",
        "member.invited",
        "member.invitation_revoked",
        "member.joined",
        "member.role_changed",
        "member.removed",
        "secret.created",
        "secret.updated",
        "secret.deleted",
        "channel.created",
        "channel.updated",
        "channel.deleted",
        "channel.tested",
        "test.created",
        "test.updated",
        "test.deleted",
        "test.run_manual",
        "monitor.created",
        "monitor.updated",
        "monitor.deleted",
        "billing.subscription_updated",
        "auth.password_reset",
      ].sort(),
    );
  });
});
