import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Bindings } from "../server/env";

declare global {
  namespace Cloudflare {
    interface Env extends Omit<Bindings, "ASSETS"> {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
