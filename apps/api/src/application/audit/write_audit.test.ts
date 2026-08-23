import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { AuditRepo } from "../../domain/audit/repo";
import { FixedClock } from "../../shared/clock";
import { FakeTrackEvent } from "../../test/fakes/activity";
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
        "security.encryption_rotated",
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
        "billing.grant_issued",
        "billing.grant_redeemed",
        "auth.password_reset",
        "api_key.created",
        "api_key.revoked",
        "alerts.settings_updated",
        "alerts.credit_topup",
        "alerts.credit_adjusted",
      ].sort(),
    );
  });

  it("bridges every audited action into an activity event", async () => {
    const audits = new FakeAuditRepo();
    const activity = new FakeTrackEvent();
    const writer = new WriteAudit({
      audits,
      activity,
      clock: new FixedClock(1_700_000_000_000),
      ids: new FakeIds(),
    });

    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.testCreated,
      resourceType: "browser_test",
      resourceId: "bt_1",
      metadata: { name: "Checkout", password: "hidden" },
      ip: "203.0.113.5",
    });

    expect(activity.calls).toEqual([
      {
        type: "browser_test.created",
        userId: "usr_actor",
        workspaceId: "ws_primary",
        source: "server",
        resourceId: "bt_1",
        properties: { name: "Checkout", password: "hidden" },
      },
    ]);
    expect(audits.entries.size).toBe(1);
  });

  it("bridges system actions with a null actor and without metadata", async () => {
    const activity = new FakeTrackEvent();
    const writer = new WriteAudit({
      audits: new FakeAuditRepo(),
      activity,
      clock: new FixedClock(1),
      ids: new FakeIds(),
    });
    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: null,
      action: AUDIT_ACTIONS.billingSubscriptionUpdated,
    });
    expect(activity.calls).toEqual([
      {
        type: "billing.subscription_updated",
        userId: null,
        workspaceId: "ws_primary",
        source: "server",
        resourceId: null,
      },
    ]);
  });

  it("still writes the audit entry when no activity tracker is configured", async () => {
    const audits = new FakeAuditRepo();
    const writer = new WriteAudit({ audits, clock: new FixedClock(1), ids: new FakeIds() });
    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.workspaceUpdated,
    });
    expect(audits.entries.size).toBe(1);
  });

  it("does not bridge when the audit insert failed", async () => {
    const audits = new FakeAuditRepo();
    audits.insert = async () => {
      throw new Error("D1 down");
    };
    const activity = new FakeTrackEvent();
    const writer = new WriteAudit({ audits, activity, clock: new FixedClock(1), ids: new FakeIds() });
    await writer.execute({
      workspaceId: "ws_primary",
      actorUserId: "usr_actor",
      action: AUDIT_ACTIONS.workspaceUpdated,
    });
    expect(activity.calls).toEqual([]);
  });
});
