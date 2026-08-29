import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeStatusPageRepo } from "../../test/fakes/status_page_repos";
import { PublishStatusPage } from "./publish_status_page";

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

function page(id: string): StatusPage {
  return {
    id,
    workspaceId: "ws_1",
    slug: "acme",
    title: "Acme Status",
    description: null,
    accentColor: null,
    theme: "SYSTEM",
    publishedAt: null,
    createdBy: "usr_1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function build(clock = new FixedClock(NOW + 1_000)) {
  const pages = new FakeStatusPageRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const useCase = new PublishStatusPage(
    pages,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    clock,
  );
  return { pages, audits, useCase, clock };
}

describe("PublishStatusPage", () => {
  it("publishes idempotently and unpublishes", async () => {
    const { pages, audits, useCase, clock } = build();
    await pages.insert(page("sp_1"));

    const published = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      publish: true,
    });
    expect(published.publishedAt).toBe(NOW + 1_000);
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.statusPagePublished);

    clock.advance(9_000);
    const again = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      publish: true,
    });
    expect(again.publishedAt).toBe(NOW + 1_000);

    const unpublished = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      publish: false,
    });
    expect(unpublished.publishedAt).toBeNull();
    expect(audits.at(-1)?.action).toBe(AUDIT_ACTIONS.statusPageUnpublished);
  });

  it("rejects MEMBER role and unknown pages", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        pageId: "sp_1",
        publish: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_missing",
        publish: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
