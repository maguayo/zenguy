import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import { computeNextRunAt } from "../../domain/browser_tests/rules";
import type { ChannelRepo } from "../../domain/channels/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, throwIfCollectionCap } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import {
  parseBrowserTestConfig,
  validateChannelIds,
} from "./input";
import { browserTestOutput, type BrowserTestOutput } from "./types";

export class CreateBrowserTest {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    config: unknown;
    ip?: string;
  }): Promise<BrowserTestOutput> {
    if (!can(input.actorRole, "tests.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const config = parseBrowserTestConfig(input.config);
    const channelIds = await validateChannelIds(
      this.channels,
      input.workspaceId,
      config.channelIds,
    );
    const now = this.clock.now();
    const test = {
      id: this.ids.newId("bt"),
      workspaceId: input.workspaceId,
      name: config.name,
      allowedDomains: [...config.allowedDomains],
      writableDomains: [...config.writableDomains],
      testDataAttested: config.testDataAttested,
      irreversibleActionScopes: structuredClone(
        config.irreversibleActionScopes,
      ),
      startUrl: config.startUrl,
      instructions: config.instructions,
      device: config.device,
      intervalHours: config.intervalHours,
      maxRetries: config.maxRetries,
      notifyOnRecovery: config.notifyOnRecovery,
      nextRunAt: computeNextRunAt(now, config.intervalHours),
      createdBy: input.actor.id,
      updatedBy: input.actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    try {
      await this.tests.insert(test);
    } catch (error) {
      throwIfCollectionCap(error);
      throw error;
    }
    await this.tests.setChannels(test.id, channelIds);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.testCreated,
      resourceType: "browser_test",
      resourceId: test.id,
      metadata: { name: test.name },
      ip: input.ip,
    });
    return browserTestOutput(test, channelIds, input.actor, null);
  }
}
