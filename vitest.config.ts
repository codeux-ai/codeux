import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["dist/**", "dashboard/dist/**", "node_modules/**"],
    // Default environment is node, specific UI tests handle this via @vitest-environment jsdom pragmas
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        // Never lower these thresholds only increase is allowed!
        lines: 74.74,
        functions: 69,
        branches: 62.53,
        statements: 74.22,
        // Specifically enforce minimum 80% on activity-cache-service.ts as per task requirement
        "src/server/activity-cache-service.ts": {
          lines: 80,
        }
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/services/embedding-service.ts",
        "src/services/embedding-tokenizer.ts"
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
