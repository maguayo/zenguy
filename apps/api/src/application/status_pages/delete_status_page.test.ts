import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeStatusPageRepo } from "../../test/fakes/status_page_repos";
import { DeleteStatusPage } from "./delete_status_page";

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

function page(id: string, workspaceId = "ws_1"): StatusPage {
  return {
    id,
    workspaceId,
    slug: `slug-${id}`,
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

function build() {
  const pages = new FakeStatusPageRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const useCase = new DeleteStatusPage(
    pages,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    new FixedClock(NOW + 1_000),
  );
  return { pages, audits, useCase };
}

describe("DeleteStatusPage", () => {
  it("soft-deletes the page, frees the slug and audits", async () => {
    const { pages, audits, useCase } = build();
    await pages.insert(page("sp_1"));
    await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "OWNER",
      pageId: "sp_1",
    });
    expect(await pages.findById("ws_1", "sp_1")).toBeNull();
    expect(await pages.findBySlug("slug-sp_1")).toBeNull();
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.statusPageDeleted);
  });

  it("rejects MEMBER role and cross-workspace pages", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1"));
    await pages.insert(page("sp_foreign", "ws_2"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        pageId: "sp_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_foreign",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
