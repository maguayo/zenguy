import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "..", "api", "migrations"),
      );
      return {
        remoteBindings: false,
        miniflare: {
          compatibilityDate: "2026-08-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "zenguy-admin-test" },
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_USER_IDS: "usr_00000000000000000000000001",
            ZENGUY_API_ORIGIN: "https://api.zenguy.test",
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
