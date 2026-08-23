import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react(), tailwindcss()],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      port: 5175,
      proxy: {
        "/api": {
          target: env.ADMIN_API_ORIGIN || "http://127.0.0.1:8795",
          changeOrigin: false,
        },
      },
    },
  };
});
