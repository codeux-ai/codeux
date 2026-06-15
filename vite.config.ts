import path from "node:path";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "dashboard",
  cacheDir: "../.cache/vite/dashboard",
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "0.0.0"),
  },
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
    // monaco-editor ships self-hosted language workers (notably ts.worker at
    // ~6.9MB) plus a large lazy-loaded editor chunk. They are fetched on demand
    // when the in-app code editor opens — never part of the initial page load —
    // and cannot be split further without dropping language IntelliSense. The
    // limit is set above those known chunks so the build stays clean while still
    // surfacing unexpected growth in regular application code.
    chunkSizeWarningLimit: 7000,
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
