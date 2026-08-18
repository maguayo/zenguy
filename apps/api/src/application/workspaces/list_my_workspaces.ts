import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Role, Workspace } from "../../domain/workspaces/types";

export interface WorkspaceOutput {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: Role;
  subscriptionStatus: "NONE";
  createdAt: number;
}

export function workspaceOutput(
  workspace: Workspace,
  role: Role,
): WorkspaceOutput {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    role,
    subscriptionStatus: "NONE",
    createdAt: workspace.createdAt,
  };
}

export class ListMyWorkspaces {
  constructor(private readonly workspaces: WorkspaceRepo) {}

  async execute(input: { userId: string }): Promise<WorkspaceOutput[]> {
    return (await this.workspaces.listForUser(input.userId)).map(
      ({ workspace, role }) => workspaceOutput(workspace, role),
    );
  }
}
