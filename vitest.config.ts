import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["dist/**", "dashboard/dist/**", "node_modules/**"],
    environment: "node",
    coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        thresholds: {
            lines: 79.4,
            functions: 69,
            branches: 64,
            statements: 78.5,
            // Specifically enforce 80% on activity-cache-service.ts as per task requirement
            "src/server/activity-cache-service.ts": {
                lines: 80,
            }
        },
        include: ["src/**/*.ts"],
        exclude: ["src/services/embedding-service.ts", "src/services/embedding-tokenizer.ts"],
    }
  },
});
