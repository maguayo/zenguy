import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import type {
  StatusPageItemRepo,
  StatusPageRepo,
} from "../../domain/status_pages/repo";
import { throwIfDuplicateItem } from "../../domain/status_pages/rules";
import type { StatusPageItem } from "../../domain/status_pages/types";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import {
  forbidden,
  notFound,
  throwIfCollectionCap,
} from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { parseStatusPageItemConfig } from "./input";

export class AddStatusPageItem {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly items: StatusPageItemRepo,
    private readonly monitors: Pick<MonitorRepo, "findById">,
    private readonly tests: Pick<BrowserTestRepo, "findById">,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    pageId: string;
    config: unknown;
    ip?: string;
  }): Promise<StatusPageItem> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const page = await this.pages.findById(input.workspaceId, input.pageId);
    if (page === null) throw notFound("Status page");
    const config = parseStatusPageItemConfig(input.config);

    let browserTestId: string | null = null;
    let uptimeMonitorId: string | null = null;
    if (config.resourceType === "UPTIME_MONITOR") {
      const monitor = await this.monitors.findById(
        input.workspaceId,
        config.resourceId,
      );
      if (monitor === null || monitor.deletedAt !== null) {
        throw notFound("Uptime monitor");
      }
      uptimeMonitorId = monitor.id;
    } else {
      const test = await this.tests.findById(
        input.workspaceId,
        config.resourceId,
      );
      if (test === null || test.deletedAt !== null) {
        throw notFound("Browser test");
      }
      browserTestId = test.id;
    }

    const existing = await this.items.listForPage(page.id);
    const position =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((entry) => entry.position)) + 1;
    const item: StatusPageItem = {
      id: this.ids.newId("spi"),
      statusPageId: page.id,
      workspaceId: input.workspaceId,
      resourceType: config.resourceType,
      browserTestId,
      uptimeMonitorId,
      displayName: config.displayName,
      groupName: config.groupName ?? null,
      position,
      createdAt: this.clock.now(),
    };
    try {
      await this.items.insert(item);
    } catch (error) {
      throwIfDuplicateItem(error);
      throwIfCollectionCap(error);
      throw error;
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageItemsChanged,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: {
        op: "added",
        itemId: item.id,
        resourceType: config.resourceType,
        resourceId: config.resourceId,
      },
      ip: input.ip,
    });
    return item;
  }
}
