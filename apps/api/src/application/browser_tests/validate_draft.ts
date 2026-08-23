import type { TrackEvent } from "../activity/track_event";
import type { WriteAudit } from "../audit/write_audit";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
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
    private readonly track?: Pick<TrackEvent, "execute">,
    private readonly audit?: Pick<WriteAudit, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    config: unknown;
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
      source: "VALIDATION",
      config: input.config,
      triggeredByUserId: input.actor.id,
      ...(input.approveIrreversibleActions === true
        ? { approveIrreversibleActions: true as const }
        : {}),
    });
    if (run.snapshot?.irreversibleAuthorization !== undefined) {
      const audit = this.audit;
      await audit?.execute({
        workspaceId: input.workspaceId,
        actorUserId: input.actor.id,
        action: AUDIT_ACTIONS.testRunManual,
        resourceType: "test_run",
        resourceId: run.id,
        metadata: {
          source: "VALIDATION",
          irreversibleActionScopeCount:
            run.snapshot.irreversibleAuthorization.scopes.length,
          originalInstructionsSha256:
            run.snapshot.irreversibleAuthorization.originalInstructionsSha256,
        },
        ip: input.ip,
      });
    }
    await this.track?.execute({
      type: ACTIVITY_EVENTS.browserTestValidated,
      userId: input.actor.id,
      workspaceId: input.workspaceId,
      source: "server",
      properties: { runId: run.id },
    });
    return run;
  }
}
