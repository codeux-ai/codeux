import path from "node:path";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "dashboard",
  cacheDir: "../.cache/vite/dashboard",
  plugins: [preact({ reactAliasesEnabled: false }), tailwindcss()],
  resolve: {
    alias: [
      { find: /^react-dom\/test-utils$/, replacement: "preact/test-utils" },
      { find: /^react-dom$/, replacement: "preact/compat" },
      { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
      { find: /^react$/, replacement: path.resolve(__dirname, "dashboard/src/lib/react-compat.js") },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 510,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/preact")
            || id.includes("node_modules/react")
            || id.includes("node_modules/react-dom")
          ) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
});
