import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://zenguy.com",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
    // Keep client scripts external so the Pages CSP can retain script-src
    // without 'unsafe-inline'.
    build: { assetsInlineLimit: 0 },
  },
});
