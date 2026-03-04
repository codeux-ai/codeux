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
            lines: 73,
            functions: 69,
            branches: 61,
            statements: 72,
        },
        include: ["src/**/*.ts"],
    }
  },
});
