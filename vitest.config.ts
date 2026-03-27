import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["dist/**", "dashboard/dist/**", "node_modules/**"],
    environmentMatchGlobs: [
      ['tests/dashboard/**', 'jsdom'],
      ['tests/backend/**', 'node'],
    ],
    coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        thresholds: {
            lines: 65,
            functions: 55,
            branches: 55,
            statements: 65,
            "src/server/activity-cache-service.ts": {
                lines: 80,
            }
        },
        include: ["src/**/*.ts", "dashboard/src/v2/lib/**/*.ts", "dashboard/src/v2/components/**/*.tsx", "dashboard/src/v2/components/**/*.ts"],
        exclude: ["src/services/embedding-service.ts", "src/services/embedding-tokenizer.ts"],
    }
  },
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
  },
});
