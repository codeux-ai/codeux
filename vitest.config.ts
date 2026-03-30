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
            lines: 50,
            functions: 40,
            branches: 40,
            statements: 50,
            // Specifically enforce 80% on activity-cache-service.ts as per task requirement
            "src/server/activity-cache-service.ts": {
                lines: 80,
            }
        },
        include: ["src/**/*.ts", "dashboard/src/**/*.{ts,tsx}"],
        exclude: ["src/services/embedding-service.ts", "src/services/embedding-tokenizer.ts"],
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
