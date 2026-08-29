import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { MAX_INCIDENT_UPDATE_LENGTH } from "../../shared/constants";
import { FakeIds } from "../../test/fakes/ids";
import { FakeIncidentRepo } from "../../test/fakes/incident_repos";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeIncidentUpdateRepo } from "../../test/fakes/status_page_repos";
import { PostIncidentUpdate } from "./post_incident_update";

const NOW = 1_756_400_000_000;
const ACTOR: User = {
  id: "usr_1",
  name: "Owner",
  email: "owner@zenguy.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function subscription(workspaceId: string): Subscription {
  return {
    id: `sub_${workspaceId}`,
    workspaceId,
    provider: "paddle",
    providerCustomerId: "ctm_1",
    providerSubscriptionId: "psub_1",
    status: "ACTIVE",
    periodStart: NOW - 1,
    periodEnd: NOW + 10_000,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function build() {
  const incidents = new FakeIncidentRepo();
  const updates = new FakeIncidentUpdateRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const useCase = new PostIncidentUpdate(
    incidents,
    updates,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    new FixedClock(NOW + 1_000),
    new FakeIds(),
  );
  return { incidents, updates, audits, useCase };
}

async function seedIncident(
  incidents: FakeIncidentRepo,
  id: string,
  workspaceId = "ws_1",
): Promise<void> {
  await incidents.insertOpen({
    id,
    workspaceId,
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: `mon_${id}`,
    status: "OPEN",
    openedAt: NOW,
    resolvedAt: null,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: `chk_${id}`,
    resolvedByCheckId: null,
    lastEventAt: NOW,
    createdAt: NOW,
  });
}

describe("PostIncidentUpdate", () => {
  it("creates a trimmed update and audits it", async () => {
    const { incidents, updates, audits, useCase } = build();
    await seedIncident(incidents, "inc_1");
    const update = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      incidentId: "inc_1",
      message: "  We are investigating elevated error rates.  ",
    });
    expect(update.message).toBe("We are investigating elevated error rates.");
    expect(update.incidentId).toBe("inc_1");
    expect(update.createdBy).toBe(ACTOR.id);
    expect(await updates.listForIncident("inc_1")).toHaveLength(1);
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.incidentUpdatePosted);
    expect(audits[0]?.resourceId).toBe("inc_1");
  });

  it("rejects MEMBER, foreign incidents, and invalid messages", async () => {
    const { incidents, useCase } = build();
    await seedIncident(incidents, "inc_1");
    await seedIncident(incidents, "inc_foreign", "ws_2");

    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        incidentId: "inc_1",
        message: "Nope",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        incidentId: "inc_foreign",
        message: "Nope",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const message of ["   ", "x".repeat(MAX_INCIDENT_UPDATE_LENGTH + 1)]) {
      await expect(
        useCase.execute({
          workspaceId: "ws_1",
          actor: ACTOR,
          actorRole: "ADMIN",
          incidentId: "inc_1",
          message,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });
});
