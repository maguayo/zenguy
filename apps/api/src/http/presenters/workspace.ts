import type { WorkspaceOutput } from "../../application/workspaces/list_my_workspaces";

export function presentWorkspace(workspace: WorkspaceOutput) {
  return {
    ...workspace,
    createdAt: new Date(workspace.createdAt).toISOString(),
  };
}
