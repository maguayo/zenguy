import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { TestRun } from "../../domain/browser_tests/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden } from "../../shared/errors";
import type { RateLimiter } from "../../shared/ratelimit";
import type { CreateRun } from "./create_run";
import { enforceRunCreateRate } from "./run_rate";

export class RunNow {
  constructor(
    private readonly createRun: Pick<CreateRun, "execute">,
    private readonly subscriptions: SubscriptionRepo,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: Pick<WriteAudit, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    testId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
    approveIrreversibleActions?: true;
  }): Promise<TestRun> {
    if (!can(input.actorRole, "tests.run")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    await enforceRunCreateRate(
      this.rateLimiter,
      input.workspaceId,
      input.actor.id,
      input.ip,
    );
    const run = await this.createRun.execute({
      workspaceId: input.workspaceId,
      source: "MANUAL",
      testId: input.testId,
      triggeredByUserId: input.actor.id,
      ...(input.approveIrreversibleActions === true
        ? { approveIrreversibleActions: true as const }
        : {}),
    });
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.testRunManual,
      resourceType: "browser_test",
      resourceId: input.testId,
      metadata: {
        runId: run.id,
        irreversibleActionsApproved:
          run.snapshot.irreversibleAuthorization !== undefined,
        irreversibleActionScopeCount:
          run.snapshot.irreversibleAuthorization?.scopes.length ?? 0,
        originalInstructionsSha256:
          run.snapshot.irreversibleAuthorization?.originalInstructionsSha256 ??
          null,
      },
      ip: input.ip,
    });
    return run;
  }
}
