import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // La suite corre en Node: `cloudflare:workers` (que importa
      // @cloudflare/containers) se sustituye por un stub mínimo.
      "cloudflare:workers": fileURLToPath(
        new URL("./src/test/stubs/cloudflare_workers.ts", import.meta.url),
      ),
    },
  },
  test: { include: ["src/**/*.test.ts"], globals: true },
});
