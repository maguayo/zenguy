import type { Bindings } from "../shared/config";
import type { User } from "../domain/users/types";
import type { Role, Workspace } from "../domain/workspaces/types";

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    user: User;
    workspace: Workspace;
    role: Role;
  };
}
