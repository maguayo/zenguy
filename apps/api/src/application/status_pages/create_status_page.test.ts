import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import { AppError } from "../../shared/errors";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { FakeStatusPageRepo } from "../../test/fakes/status_page_repos";
import { CreateStatusPage } from "./create_status_page";

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
  const pages = new FakeStatusPageRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const useCase = new CreateStatusPage(
    pages,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    new FixedClock(NOW),
    new FakeIds(),
  );
  return { pages, audits, useCase };
}

describe("CreateStatusPage", () => {
  it("creates a draft page with a valid slug and writes an audit entry", async () => {
    const { pages, audits, useCase } = build();
    const page = await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      config: { title: "  Acme Status  ", slug: "acme", theme: "DARK" },
    });
    expect(page.title).toBe("Acme Status");
    expect(page.slug).toBe("acme");
    expect(page.theme).toBe("DARK");
    expect(page.publishedAt).toBeNull();
    expect(page.createdBy).toBe(ACTOR.id);
    expect(await pages.findBySlug("acme")).not.toBeNull();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe(AUDIT_ACTIONS.statusPageCreated);
    expect(audits[0]?.resourceId).toBe(page.id);
  });

  it("rejects MEMBER role with FORBIDDEN", async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        config: { title: "Acme", slug: "acme" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects reserved slugs with VALIDATION_ERROR", async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        config: { title: "Acme", slug: "preview" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects malformed slugs", async () => {
    const { useCase } = build();
    for (const slug of ["Ab", "-x-", "a".repeat(64), "es", "a b"]) {
      await expect(
        useCase.execute({
          workspaceId: "ws_1",
          actor: ACTOR,
          actorRole: "OWNER",
          config: { title: "Acme", slug },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("maps a duplicate slug to CONFLICT", async () => {
    const { useCase, audits } = build();
    await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "OWNER",
      config: { title: "Acme", slug: "acme" },
    });
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        config: { title: "Copy", slug: "acme" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(audits).toHaveLength(1);
  });

  it("maps the page cap trigger to RATE_LIMITED", async () => {
    const { useCase } = build();
    for (let index = 0; index < 5; index += 1) {
      await useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        config: { title: "Acme", slug: `acme-${index}` },
      });
    }
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "OWNER",
        config: { title: "Acme", slug: "acme-over" },
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("requires an active subscription", async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        workspaceId: "ws_without_subscription",
        actor: ACTOR,
        actorRole: "OWNER",
        config: { title: "Acme", slug: "acme" },
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
