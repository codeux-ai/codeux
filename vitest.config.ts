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
            lines: 65,
            functions: 60,
            branches: 55,
            statements: 65,
        },
        include: ["src/**/*.ts"],
    }
  },
});
