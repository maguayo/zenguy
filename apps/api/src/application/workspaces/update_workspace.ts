import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import { can } from "../../domain/workspaces/permissions";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Role, Workspace } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden, validation } from "../../shared/errors";
import type { Clock } from "../../shared/clock";
import type { WriteAudit } from "../audit/write_audit";
import { workspaceName, workspaceTimezone } from "./input";
import { workspaceOutput, type WorkspaceOutput } from "./list_my_workspaces";

export interface UpdateWorkspaceDependencies {
  workspaces: WorkspaceRepo;
  subscriptions: SubscriptionRepo;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
}

export class UpdateWorkspace {
  constructor(private readonly dependencies: UpdateWorkspaceDependencies) {}

  async execute(input: {
    workspace: Workspace;
    role: Role;
    actor: User;
    name?: string;
    timezone?: string;
    ip?: string;
  }): Promise<WorkspaceOutput> {
    if (!can(input.role, "workspace.settings")) throw forbidden();
    if (input.name === undefined && input.timezone === undefined) {
      throw validation([
        { field: "body", message: "At least one field is required" },
      ]);
    }

    const changes = {
      ...(input.name === undefined ? {} : { name: workspaceName(input.name) }),
      ...(input.timezone === undefined
        ? {}
        : { timezone: workspaceTimezone(input.timezone) }),
    };
    const now = this.dependencies.clock.now();
    await this.dependencies.workspaces.update(input.workspace.id, changes, now);
    const updated = { ...input.workspace, ...changes, updatedAt: now };
    await this.dependencies.audit.execute({
      workspaceId: updated.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.workspaceUpdated,
      resourceType: "workspace",
      resourceId: updated.id,
      metadata: { changedFields: Object.keys(changes) },
      ip: input.ip,
    });
    const subscription = await this.dependencies.subscriptions.findByWorkspace(
      updated.id,
    );
    return workspaceOutput(
      updated,
      input.role,
      subscription?.status ?? "NONE",
    );
  }
}
