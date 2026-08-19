import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import { forbidden } from "../../shared/errors";
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
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    config: unknown;
  }): Promise<TestRequestOutput> {
    if (!can(input.actorRole, "uptime.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const config = parseMonitorTestRequest(input.config);
    await validateMonitorChannelIds(
      this.channels,
      input.workspaceId,
      config.channelIds,
    );
    await enforceTestRequestRate(this.rateLimiter, input.workspaceId);
    const outcome = await this.executeCheck(config, input.workspaceId);
    return { ...outcome, passed: outcome.status === "PASSED" };
  }
}
