import type { WriteAuditInput } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { StatusPage } from "../../domain/status_pages/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakeBrowserTestRepo } from "../../test/fakes/browser_test_repos";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import {
  FakeStatusPageItemRepo,
  FakeStatusPageRepo,
} from "../../test/fakes/status_page_repos";
import { FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { AddStatusPageItem } from "./add_item";
import { RemoveStatusPageItem } from "./remove_item";
import { UpdateStatusPageItem } from "./update_item";

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

function monitor(id: string, workspaceId = "ws_1"): UptimeMonitor {
  return {
    id,
    workspaceId,
    name: `internal ${id}`,
    url: `https://${id}.internal.example.com/health`,
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: NOW,
    currentStatus: "UP",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: "usr_1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function browserTest(id: string, workspaceId = "ws_1"): BrowserTest {
  return {
    id,
    workspaceId,
    name: `internal test ${id}`,
    allowedDomains: [],
    writableDomains: [],
    testDataAttested: false,
    irreversibleActionScopes: [],
    startUrl: "https://shop.example.com",
    instructions: "Check the checkout works",
    device: "DESKTOP",
    intervalHours: 6,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextRunAt: NOW,
    createdBy: "usr_1",
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function build() {
  const pages = new FakeStatusPageRepo();
  const items = new FakeStatusPageItemRepo();
  const monitors = new FakeMonitorRepo();
  const tests = new FakeBrowserTestRepo();
  const subscriptions = new FakeSubscriptionRepo();
  subscriptions.subscriptions.set("ws_1", subscription("ws_1"));
  const audits: WriteAuditInput[] = [];
  const audit = { execute: async (entry: WriteAuditInput) => void audits.push(entry) };
  const clock = new FixedClock(NOW + 1_000);
  const ids = new FakeIds();
  const addItem = new AddStatusPageItem(
    pages,
    items,
    monitors,
    tests,
    subscriptions,
    audit,
    clock,
    ids,
  );
  const updateItem = new UpdateStatusPageItem(
    pages,
    items,
    subscriptions,
    audit,
    clock,
  );
  const removeItem = new RemoveStatusPageItem(
    pages,
    items,
    subscriptions,
    audit,
    clock,
  );
  return { pages, items, monitors, tests, audits, addItem, updateItem, removeItem };
}

describe("AddStatusPageItem", () => {
  it("adds a monitor and a browser test with increasing positions", async () => {
    const { pages, items, monitors, tests, audits, addItem } = build();
    await pages.insert(page("sp_1"));
    await monitors.insert(monitor("mon_1"));
    tests.tests.set("bt_1", browserTest("bt_1"));

    const first = await addItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      config: {
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_1",
        displayName: "API",
      },
    });
    expect(first.uptimeMonitorId).toBe("mon_1");
    expect(first.browserTestId).toBeNull();
    expect(first.position).toBe(0);

    const second = await addItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      config: {
        resourceType: "BROWSER_TEST",
        resourceId: "bt_1",
        displayName: "Checkout",
        groupName: "Shop",
      },
    });
    expect(second.browserTestId).toBe("bt_1");
    expect(second.position).toBe(1);
    expect(second.groupName).toBe("Shop");
    expect((await items.listForPage("sp_1")).map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(
      audits.every(
        (entry) => entry.action === AUDIT_ACTIONS.statusPageItemsChanged,
      ),
    ).toBe(true);
  });

  it("rejects resources from another workspace or missing", async () => {
    const { pages, monitors, addItem } = build();
    await pages.insert(page("sp_1"));
    await monitors.insert(monitor("mon_foreign", "ws_2"));
    for (const resourceId of ["mon_foreign", "mon_missing"]) {
      await expect(
        addItem.execute({
          workspaceId: "ws_1",
          actor: ACTOR,
          actorRole: "ADMIN",
          pageId: "sp_1",
          config: {
            resourceType: "UPTIME_MONITOR",
            resourceId,
            displayName: "API",
          },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("maps duplicates to CONFLICT and MEMBER to FORBIDDEN", async () => {
    const { pages, monitors, addItem } = build();
    await pages.insert(page("sp_1"));
    await monitors.insert(monitor("mon_1"));
    await addItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      config: {
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_1",
        displayName: "API",
      },
    });
    await expect(
      addItem.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_1",
        config: {
          resourceType: "UPTIME_MONITOR",
          resourceId: "mon_1",
          displayName: "API again",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      addItem.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "MEMBER",
        pageId: "sp_1",
        config: {
          resourceType: "UPTIME_MONITOR",
          resourceId: "mon_1",
          displayName: "API",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("UpdateStatusPageItem / RemoveStatusPageItem", () => {
  it("renames, regroups and removes items on the page", async () => {
    const { pages, items, monitors, addItem, updateItem, removeItem } = build();
    await pages.insert(page("sp_1"));
    await monitors.insert(monitor("mon_1"));
    const added = await addItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      config: {
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_1",
        displayName: "API",
      },
    });

    const renamed = await updateItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      itemId: added.id,
      config: { displayName: "Public API", groupName: "Core" },
    });
    expect(renamed.displayName).toBe("Public API");
    expect(renamed.groupName).toBe("Core");

    await removeItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      itemId: added.id,
    });
    expect(await items.listForPage("sp_1")).toEqual([]);
  });

  it("returns NOT_FOUND for an item of another page", async () => {
    const { pages, monitors, addItem, updateItem } = build();
    await pages.insert(page("sp_1"));
    await pages.insert(page("sp_2"));
    await monitors.insert(monitor("mon_1"));
    const added = await addItem.execute({
      workspaceId: "ws_1",
      actor: ACTOR,
      actorRole: "ADMIN",
      pageId: "sp_1",
      config: {
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_1",
        displayName: "API",
      },
    });
    await expect(
      updateItem.execute({
        workspaceId: "ws_1",
        actor: ACTOR,
        actorRole: "ADMIN",
        pageId: "sp_2",
        itemId: added.id,
        config: { displayName: "Nope" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
