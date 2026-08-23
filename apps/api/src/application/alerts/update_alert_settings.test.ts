import { WriteAudit } from "../audit/write_audit";
import { defaultAlertSettings } from "../../domain/alerts/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { FakeIds } from "../../test/fakes/ids";
import { FakeAuditRepo } from "../../test/fakes/repos";
import { UpdateAlertSettings } from "./update_alert_settings";

const NOW = 1_700_000_000_000;
const ACTOR: User = {
  id: "usr_admin",
  name: "Admin",
  email: "admin@acme.test",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

function fixture(topUpAvailable: boolean) {
  const alerts = new FakeAlertRepo();
  const audits = new FakeAuditRepo();
  const clock = new FixedClock(NOW);
  const useCase = new UpdateAlertSettings(
    alerts,
    new WriteAudit({ audits, clock, ids: new FakeIds() }),
    topUpAvailable,
    clock,
  );
  return { alerts, audits, useCase };
}

describe("UpdateAlertSettings", () => {
  it("turns paid channels on and changes the daily limit with an audit trail", async () => {
    const { alerts, audits, useCase } = fixture(true);

    const result = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "OWNER",
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 50,
      ip: "203.0.113.1",
    });

    expect(result).toMatchObject({
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 50,
      updatedAt: NOW,
    });
    expect(alerts.settings.get("ws_1")).toMatchObject({
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 50,
    });
    const entries = await audits.list("ws_1", null, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "alerts.settings_updated",
      actorUserId: "usr_admin",
    });
    expect(JSON.parse(entries[0]?.metadataJson ?? "null")).toEqual({
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 50,
      changedFields: ["paidChannelsEnabled", "dailyPaidAlertLimit"],
    });
  });

  it("rejects members, empty updates, and out-of-range limits", async () => {
    const { useCase } = fixture(true);
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        paidChannelsEnabled: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      useCase.execute({ workspaceId: "ws_1", actor: ACTOR, actorRole: "OWNER" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    for (const dailyPaidAlertLimit of [0, 201, 2.5]) {
      await expect(
        useCase.execute({
          workspaceId: "ws_1",
          actor: ACTOR,
          actorRole: "OWNER",
          dailyPaidAlertLimit,
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: [{ field: "dailyPaidAlertLimit", message: expect.any(String) }],
      });
    }
  });

  it("cannot enable paid channels without top-ups unless credit already exists", async () => {
    const { alerts, useCase } = fixture(false);
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        paidChannelsEnabled: true,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ field: "paidChannelsEnabled", message: expect.any(String) }],
    });
    expect(alerts.settings.get("ws_1")?.paidChannelsEnabled).toBe(false);

    alerts.setBalance("ws_1", 500);
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        paidChannelsEnabled: true,
      }),
    ).resolves.toMatchObject({ paidChannelsEnabled: true });

    // Turning off never needs top-ups.
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        paidChannelsEnabled: false,
      }),
    ).resolves.toMatchObject({ paidChannelsEnabled: false });
  });

  it("keeps existing settings when only one field changes", async () => {
    const { alerts, useCase } = fixture(true);
    alerts.settings.set("ws_1", {
      ...defaultAlertSettings("ws_1", 1),
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 7,
    });
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        dailyPaidAlertLimit: 9,
      }),
    ).resolves.toMatchObject({ paidChannelsEnabled: true, dailyPaidAlertLimit: 9 });
  });
});
