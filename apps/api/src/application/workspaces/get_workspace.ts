import type { Role, Workspace } from "../../domain/workspaces/types";
import { workspaceOutput, type WorkspaceOutput } from "./list_my_workspaces";

export class GetWorkspace {
  async execute(input: {
    workspace: Workspace;
    role: Role;
  }): Promise<WorkspaceOutput> {
    return workspaceOutput(input.workspace, input.role);
  }
}
