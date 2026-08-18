import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { MemberRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import { uniqueSlug } from "../../domain/workspaces/slug";
import type { User } from "../../domain/users/types";
import type { WriteAudit } from "../audit/write_audit";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { workspaceName, workspaceTimezone } from "./input";
import { workspaceOutput, type WorkspaceOutput } from "./list_my_workspaces";

export interface CreateWorkspaceDependencies {
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
}

export class CreateWorkspace {
  constructor(private readonly dependencies: CreateWorkspaceDependencies) {}

  async execute(input: {
    name: string;
    timezone: string;
    actor: User;
    ip?: string;
  }): Promise<WorkspaceOutput> {
    const name = workspaceName(input.name);
    const timezone = workspaceTimezone(input.timezone);
    const now = this.dependencies.clock.now();
    const workspace = {
      id: this.dependencies.ids.newId("ws"),
      name,
      slug: await uniqueSlug(this.dependencies.workspaces, name),
      timezone,
      ownerUserId: input.actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.dependencies.workspaces.insert(workspace);
    await this.dependencies.members.insert({
      id: this.dependencies.ids.newId("mem"),
      workspaceId: workspace.id,
      userId: input.actor.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: now,
    });
    await this.dependencies.audit.execute({
      workspaceId: workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.workspaceCreated,
      resourceType: "workspace",
      resourceId: workspace.id,
      metadata: { name: workspace.name },
      ip: input.ip,
    });
    return workspaceOutput(workspace, "OWNER");
  }
}
