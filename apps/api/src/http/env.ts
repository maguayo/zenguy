import type { Bindings } from "../shared/config";

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
  };
}
