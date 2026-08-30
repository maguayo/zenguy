import type { WriteAuditInput } from "../audit/write_audit";
import type { Subscription } from "../../domain/billing/types";
import type { StatusPage, StatusPageItem } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import {
  FakeStatusPageItemRepo,
  FakeStatusPageRepo,
} from "../../test/fakes/status_page_repos";
import { ReorderStatusPageItems } from "./reorder_items";

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
    slug: `slug-${id}`,
    title: "Acme Status",
    description: null,
    accentColor: null,
    theme: "SYSTEM",
    publishedAt: null,
    customDomain: null,
    customHostnameId: null,
    customDomainStatus: null,
    customDomainCheckedAt: null,
    createdBy: "usr_1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function item(id: string, position: number): StatusPageItem {
  return {
    id,
    statusPageId: "sp_1",
    workspaceId: "ws_1",
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: `mon_${id}`,
    displayName: id,
    groupName: null,
    position,
    createdAt: NOW,
  };
}

function build() {
  const pages = new FakeStatusPageRepo();
  const items = new FakeStatusPageItemRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const useCase = new ReorderStatusPageItems(
    pages,
    items,
    subscriptions,
    { execute: async (entry) => void audits.push(entry) },
    new FixedClock(NOW + 1_000),
  );
  return { pages, items, audits, useCase };
}

describe("ReorderStatusPageItems", () => {
  it("persists the new order", async () => {
    const { pages, items, useCase } = build();
    await pages.insert(page("sp_1"));
    await items.insert(item("spi_a", 0));
    await items.insert(item("spi_b", 1));
    await items.insert(item("spi_c", 2));

    await useCase.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      itemIds: ["spi_c", "spi_a", "spi_b"],
    });
    expect((await items.listForPage("sp_1")).map((entry) => entry.id)).toEqual([
      "spi_c",
      "spi_a",
      "spi_b",
    ]);
  });

  it("rejects partial, extra or duplicated id sets", async () => {
    const { pages, items, useCase } = build();
    await pages.insert(page("sp_1"));
    await items.insert(item("spi_a", 0));
    await items.insert(item("spi_b", 1));

    for (const itemIds of [
      ["spi_a"],
      ["spi_a", "spi_b", "spi_ghost"],
      ["spi_a", "spi_a"],
      ["spi_a", "spi_ghost"],
    ]) {
      await expect(
        useCase.execute({
          workspaceId: "ws_1",
          actor: ACTOR,
          actorRole: "ADMIN",
          pageId: "sp_1",
          itemIds,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("rejects MEMBER role", async () => {
    const { pages, useCase } = build();
    await pages.insert(page("sp_1"));
    await expect(
      useCase.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        pageId: "sp_1",
        itemIds: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
