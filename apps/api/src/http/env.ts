import type { Bindings } from "../shared/config";
import type { User } from "../domain/users/types";

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    user: User;
  };
}
