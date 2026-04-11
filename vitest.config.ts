import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".cache/vitest",
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["dist/**", "dashboard/dist/**", "node_modules/**"],
    setupFiles: ["tests/setup/runtime-warning-filter.ts"],
    testTimeout: 15000,
    // Default environment is node, specific UI tests handle this via @vitest-environment jsdom pragmas
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      thresholds: {
        // Never lower these thresholds only increase is allowed!
        lines: 73.5,
        functions: 67.5,
        branches: 61.14,
        statements: 72.2,
        // Specifically enforce minimum 80% on activity-cache-service.ts as per task requirement
        "src/server/activity-cache-service.ts": {
          lines: 80,
        }
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/services/embedding-service.ts",
        "src/services/embedding-tokenizer.ts",
        "src/worker/sprint-os-worker.ts",
        "src/server/dashboard-server.ts",
        "src/server/mcp-request-router.ts",
        "src/server/websocket-server.ts",
        "src/worker/index.ts",
        "src/server/index.ts",
        "src/sprint/index.ts",
        "src/index.ts",
        "src/app-db-schema.ts",
        "src/repositories/db/sqlite-database-adapter.ts"
      ],
    }
  },
  resolve: {
    alias: {
      "react": "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    }
  },
});
