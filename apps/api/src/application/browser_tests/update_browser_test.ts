import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  BrowserTestRepo,
  BrowserTestUpdate,
  RunRepo,
} from "../../domain/browser_tests/repo";
import { computeNextRunAt } from "../../domain/browser_tests/rules";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { UserRepo } from "../../domain/users/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import {
  parseBrowserTestConfig,
  parseBrowserTestUpdate,
  validateChannelIds,
} from "./input";
import { browserTestOutput, type BrowserTestOutput } from "./types";

export class UpdateBrowserTest {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly users: UserRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    testId: string;
    actor: User;
    actorRole: Role;
    changes: unknown;
    ip?: string;
  }): Promise<BrowserTestOutput> {
    if (!can(input.actorRole, "tests.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const test = await this.tests.findById(input.workspaceId, input.testId);
    if (test === null) throw notFound("Browser test");
    const parsed = parseBrowserTestUpdate(input.changes);
    const currentChannelIds = await this.tests.getChannelIds(test.id);
    const complete = parseBrowserTestConfig({
      name: parsed.name ?? test.name,
      startUrl: parsed.startUrl ?? test.startUrl,
      instructions: parsed.instructions ?? test.instructions,
      device: parsed.device ?? test.device,
      intervalHours: parsed.intervalHours ?? test.intervalHours,
      maxRetries: parsed.maxRetries ?? test.maxRetries,
      notifyOnRecovery:
        parsed.notifyOnRecovery ?? test.notifyOnRecovery,
      channelIds: parsed.channelIds ?? currentChannelIds,
    });
    const channelIds =
      parsed.channelIds === undefined
        ? currentChannelIds
        : await validateChannelIds(
            this.channels,
            input.workspaceId,
            complete.channelIds,
          );
    const now = this.clock.now();
    const changes: BrowserTestUpdate = {
      ...(parsed.name === undefined ? {} : { name: complete.name }),
      ...(parsed.startUrl === undefined ? {} : { startUrl: complete.startUrl }),
      ...(parsed.instructions === undefined
        ? {}
        : { instructions: complete.instructions }),
      ...(parsed.device === undefined ? {} : { device: complete.device }),
      ...(parsed.intervalHours === undefined
        ? {}
        : {
            intervalHours: complete.intervalHours,
            nextRunAt: computeNextRunAt(now, complete.intervalHours),
          }),
      ...(parsed.maxRetries === undefined
        ? {}
        : { maxRetries: complete.maxRetries }),
      ...(parsed.notifyOnRecovery === undefined
        ? {}
        : { notifyOnRecovery: complete.notifyOnRecovery }),
      updatedBy: input.actor.id,
    };
    await this.tests.update(test.id, changes, now);
    if (parsed.channelIds !== undefined) {
      await this.tests.setChannels(test.id, channelIds);
    }
    const updated = { ...test, ...changes, updatedAt: now };
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.testUpdated,
      resourceType: "browser_test",
      resourceId: test.id,
      metadata: {
        name: updated.name,
        changedFields: Object.keys(parsed),
      },
      ip: input.ip,
    });
    const creator =
      updated.createdBy === null
        ? null
        : await this.users.findById(updated.createdBy);
    const lastRun =
      (await this.runs.lastRunSummaryPerTest(input.workspaceId)).get(test.id) ??
      null;
    return browserTestOutput(updated, channelIds, creator, lastRun);
  }
}
