import type { Role, Workspace } from "../../domain/workspaces/types";
import { workspaceOutput, type WorkspaceOutput } from "./list_my_workspaces";

export class GetWorkspace {
  constructor(private readonly subscriptions: SubscriptionRepo) {}

  async execute(input: {
    workspace: Workspace;
    role: Role;
  }): Promise<WorkspaceOutput> {
    const subscription = await this.subscriptions.findByWorkspace(
      input.workspace.id,
    );
    return workspaceOutput(
      input.workspace,
      input.role,
      subscription?.status ?? "NONE",
    );
  }
}
import type { SubscriptionRepo } from "../../domain/billing/repo";
