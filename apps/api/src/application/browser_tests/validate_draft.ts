import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { TestRun } from "../../domain/browser_tests/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden } from "../../shared/errors";
import type { RateLimiter } from "../../shared/ratelimit";
import type { CreateRun } from "./create_run";
import { enforceRunCreateRate } from "./run_rate";

export class ValidateDraft {
  constructor(
    private readonly createRun: Pick<CreateRun, "execute">,
    private readonly subscriptions: SubscriptionRepo,
    private readonly rateLimiter: RateLimiter,
  ) {}

  async execute(input: {
    workspaceId: string;
    config: unknown;
    actor: User;
    actorRole: Role;
  }): Promise<TestRun> {
    if (!can(input.actorRole, "tests.run")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    await enforceRunCreateRate(this.rateLimiter, input.workspaceId);
    return this.createRun.execute({
      workspaceId: input.workspaceId,
      source: "VALIDATION",
      config: input.config,
      triggeredByUserId: input.actor.id,
    });
  }
}
