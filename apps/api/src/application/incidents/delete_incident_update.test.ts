import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeIncidentUpdateRepo } from "../../test/fakes/status_page_repos";
import { DeleteIncidentUpdate } from "./delete_incident_update";

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
  const updates = new FakeIncidentUpdateRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const useCase = new DeleteIncidentUpdate(
    updates,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    new FixedClock(NOW + 1_000),
  );
  return { updates, audits, useCase };
}

describe("DeleteIncidentUpdate", () => {
  it("removes the update and audits the retraction", async () => {
    const { updates, audits, useCase } = build();
    await updates.insert({
      id: "iu_1",
      incidentId: "inc_1",
      workspaceId: "ws_1",
      message: "Wrong message",
      createdBy: "usr_1",
      createdAt: NOW,
    });
    await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      incidentId: "inc_1",
      updateId: "iu_1",
    });
    expect(await updates.listForIncident("inc_1")).toEqual([]);
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.incidentUpdateDeleted);
  });

  it("rejects MEMBER, foreign updates and mismatched incidents", async () => {
    const { updates, useCase } = build();
    await updates.insert({
      id: "iu_1",
      incidentId: "inc_1",
      workspaceId: "ws_1",
      message: "Message",
      createdBy: "usr_1",
      createdAt: NOW,
    });
    await updates.insert({
      id: "iu_foreign",
      incidentId: "inc_2",
      workspaceId: "ws_2",
      message: "Foreign",
      createdBy: "usr_2",
      createdAt: NOW,
    });

    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        incidentId: "inc_1",
        updateId: "iu_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        incidentId: "inc_2",
        updateId: "iu_foreign",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        incidentId: "inc_other",
        updateId: "iu_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
