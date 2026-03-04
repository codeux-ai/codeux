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
            lines: 80,
            functions: 80,
            branches: 70,
            statements: 80,
        },
        include: ["src/**/*.ts"],
    }
  },
});
