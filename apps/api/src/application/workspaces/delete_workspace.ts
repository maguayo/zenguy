import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { can } from "../../domain/workspaces/permissions";
import type { Role, Workspace } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, validation } from "../../shared/errors";
import type { WriteAudit } from "../audit/write_audit";

export interface WorkspaceDeletionCoordinator {
  request(workspaceId: string): Promise<boolean>;
}

export class DeleteWorkspace {
  constructor(
    private readonly deletion: WorkspaceDeletionCoordinator,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspace: Workspace;
    actor: User;
    actorRole: Role;
    confirmName: string;
    ip?: string;
  }): Promise<void> {
    if (
      !can(input.actorRole, "workspace.delete") ||
      input.workspace.ownerUserId !== input.actor.id
    ) {
      throw forbidden();
    }
    if (input.confirmName !== input.workspace.name) {
      throw validation([
        { field: "confirmName", message: "Name does not match" },
      ]);
    }

    const now = this.clock.now();
    await this.audit.execute({
      workspaceId: input.workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.workspaceDeleted,
      resourceType: "workspace",
      resourceId: input.workspace.id,
      metadata: { name: input.workspace.name },
      ip: input.ip,
    });
    await this.deletion.request(input.workspace.id);
  }
}
