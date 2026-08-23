import type { TrackEvent } from "../activity/track_event";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import { forbidden } from "../../shared/errors";
import { validation } from "../../shared/errors";
import { isMutableMonitorMethod } from "../../domain/uptime/types";
import type { RateLimiter } from "../../shared/ratelimit";
import type { CheckOutcome } from "./execute_check";
import {
  parseMonitorTestRequest,
  validateMonitorChannelIds,
} from "./input";
import { enforceTestRequestRate } from "./rate";

export type TestRequestOutput = CheckOutcome & { passed: boolean };

export class TestRequest {
  constructor(
    private readonly channels: Pick<ChannelRepo, "listByIds">,
    private readonly subscriptions: SubscriptionRepo,
    private readonly rateLimiter: RateLimiter,
    private readonly executeCheck: (
      config: ReturnType<typeof parseMonitorTestRequest>,
      workspaceId: string,
    ) => Promise<CheckOutcome>,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    config: unknown;
    ip?: string;
  }): Promise<TestRequestOutput> {
    if (!can(input.actorRole, "uptime.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    await enforceTestRequestRate(
      this.rateLimiter,
      input.workspaceId,
      input.actor.id,
      input.ip,
    );
    const config = parseMonitorTestRequest(input.config);
    // A one-off test has no durable cycle whose key can be reused after an
    // ambiguous client/provider retry. Keep this endpoint read-only; scheduled
    // monitors inject a stable Idempotency-Key derived from their cycle.
    if (isMutableMonitorMethod(config.method)) {
      throw validation([
        {
          field: "method",
          message: "Test requests only allow GET or HEAD",
        },
      ]);
    }
    await validateMonitorChannelIds(
      this.channels,
      input.workspaceId,
      config.channelIds,
    );
    const outcome = await this.executeCheck(config, input.workspaceId);
    await this.track?.execute({
      type: ACTIVITY_EVENTS.uptimeMonitorTested,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { status: outcome.status },
    });
    return { ...outcome, passed: outcome.status === "PASSED" };
  }
}
