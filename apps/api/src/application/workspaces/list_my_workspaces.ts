import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { SubscriptionStatus } from "../../domain/billing/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Role, Workspace } from "../../domain/workspaces/types";

export interface WorkspaceOutput {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: Role;
  subscriptionStatus: SubscriptionStatus;
  createdAt: number;
}

export function workspaceOutput(
  workspace: Workspace,
  role: Role,
  subscriptionStatus: SubscriptionStatus = "NONE",
): WorkspaceOutput {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    role,
    subscriptionStatus,
    createdAt: workspace.createdAt,
  };
}

export class ListMyWorkspaces {
  constructor(
    private readonly workspaces: WorkspaceRepo,
    private readonly subscriptions: SubscriptionRepo,
  ) {}

  async execute(input: { userId: string }): Promise<WorkspaceOutput[]> {
    return Promise.all(
      (await this.workspaces.listForUser(input.userId)).map(
        async ({ workspace, role }) => {
          const subscription = await this.subscriptions.findByWorkspace(
            workspace.id,
          );
          return workspaceOutput(
            workspace,
            role,
            subscription?.status ?? "NONE",
          );
        },
      ),
    );
  }
}
