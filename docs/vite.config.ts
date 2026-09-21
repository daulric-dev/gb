import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { docsNav } from "./plugins/docs-nav";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

function spaFallback() {
  return {
    name: "spa-fallback",
    closeBundle() {
      const out = join(process.cwd(), "build");
      copyFileSync(join(out, "index.html"), join(out, "404.html"));
    },
  };
}

const base = process.env.DOCS_BASE ?? "/gb/";

export default defineConfig({
  base,
  plugins: [react(), docsNav(), spaFallback()],
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 800,
  },
});
