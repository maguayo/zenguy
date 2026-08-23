import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "migrations"),
      );
      return {
        remoteBindings: false,
        // Keep the Wrangler config in a directory that has no `.dev.vars`.
        // The Cloudflare pool resolves local secret files beside configPath;
        // integration tests must use only the synthetic bindings below and in
        // testEnv(), never a developer's local credentials.
        wrangler: { configPath: "./test/wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Keep integration email traffic inside Miniflare's allowlist even
            // when a developer's .dev.vars uses a local placeholder sender.
            EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
          },
        },
      };
    }),
  ],
  test: {
    include: ["src/**/*.itest.ts"],
    globals: true,
    setupFiles: ["./src/test/apply-migrations.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
