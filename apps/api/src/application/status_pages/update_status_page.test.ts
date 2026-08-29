import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeStatusPageRepo } from "../../test/fakes/status_page_repos";
import { UpdateStatusPage } from "./update_status_page";

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

function page(id: string, slug: string, workspaceId = "ws_1"): StatusPage {
  return {
    id,
    workspaceId,
    slug,
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
  const useCase = new UpdateStatusPage(
    pages,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    new FixedClock(NOW + 5_000),
  );
  return { pages, audits, useCase };
}

describe("UpdateStatusPage", () => {
  it("updates fields and audits the change", async () => {
    const { pages, audits, useCase } = build();
    await pages.insert(page("sp_1", "acme"));
    const updated = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      config: {
        title: "Acme Cloud",
        description: "All services",
        accentColor: "#22c55e",
        theme: "LIGHT",
        slug: "acme-cloud",
      },
    });
    expect(updated.title).toBe("Acme Cloud");
    expect(updated.description).toBe("All services");
    expect(updated.accentColor).toBe("#22c55e");
    expect(updated.theme).toBe("LIGHT");
    expect(updated.slug).toBe("acme-cloud");
    expect(updated.updatedAt).toBe(NOW + 5_000);
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.statusPageUpdated);
  });

  it("rejects an invalid accent color", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1", "acme"));
    for (const accentColor of ["red", "#12345", "#GGGGGG", "#22C55E"]) {
      await expect(
        useCase.execute({
          workspaceId: "ws_1",
          actor: ACTOR,
          actorRole: "ADMIN",
          pageId: "sp_1",
          config: { accentColor },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("rejects an empty update", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1", "acme"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_1",
        config: {},
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns NOT_FOUND for a page of another workspace", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_other", "other", "ws_2"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_other",
        config: { title: "Nope" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a slug collision to CONFLICT", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1", "acme"));
    await pages.insert(page("sp_2", "acme-two"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_2",
        config: { slug: "acme" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects MEMBER role", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1", "acme"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        pageId: "sp_1",
        config: { title: "Nope" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
