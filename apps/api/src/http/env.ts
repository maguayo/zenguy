import type { Bindings } from "../shared/config";
import type { WorkspaceApiKey } from "../domain/api_keys/types";
import type { User } from "../domain/users/types";
import type { Role, Workspace } from "../domain/workspaces/types";

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    user: User;
    workspace: Workspace;
    role: Role;
    // Set only on /api/v1 routes authenticated with a workspace API key;
    // those routes have "workspace" but never "user"/"role".
    apiKey: WorkspaceApiKey;
  };
}
