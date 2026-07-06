import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const DOC_PATHS = {
  testingGuide: "docs/development/testing-and-quality.md",
  loggingGuide: "docs/operations/logging-and-correlation.md",
  runbook: "docs/operations/runbook.md",
  index: "docs/index.md",
  summary: "docs/SUMMARY.md",
} as const;

async function readRepoFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

function extractPnpmRunScripts(markdown: string): string[] {
  const scripts = new Set<string>();
  const commandPattern = /\bpnpm\s+run\s+([a-zA-Z0-9:_-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(markdown)) !== null) {
    scripts.add(match[1]);
  }

  return [...scripts].sort();
}

function expectContainsAll(content: string, terms: string[]): void {
  for (const term of terms) {
    expect(content).toContain(term);
  }
}

describe("testing and operations documentation", () => {
  it("links the required quality and operations guides from the documentation entrypoints", async () => {
    const [index, summary] = await Promise.all([
      readRepoFile(DOC_PATHS.index),
      readRepoFile(DOC_PATHS.summary),
    ]);

    for (const content of [index, summary]) {
      expect(content).toContain("./development/testing-and-quality.md");
      expect(content).toContain("./operations/logging-and-correlation.md");
      expect(content).toContain("./operations/runbook.md");
    }
  });

  it("documents only package scripts that exist in package.json", async () => {
    const [packageJsonText, ...markdownFiles] = await Promise.all([
      readRepoFile("package.json"),
      ...Object.values(DOC_PATHS).map(readRepoFile),
    ]);
    const packageJson = JSON.parse(packageJsonText) as PackageJson;
    const scripts = packageJson.scripts ?? {};
    const documentedScripts = extractPnpmRunScripts(markdownFiles.join("\n"));

    expect(documentedScripts).toEqual(expect.arrayContaining([
      "audit",
      "build",
      "ci",
      "dev",
      "lint",
      "quality:guardrails",
      "test:backend",
      "test:backend:coverage",
      "test:coverage",
      "test:dashboard",
      "typecheck",
      "typecheck:dashboard",
    ]));

    for (const script of documentedScripts) {
      expect(scripts, `Missing package.json script documented as pnpm run ${script}`).toHaveProperty(script);
    }
  });

  it("keeps testing docs aligned with real CI, coverage, Playwright, and deterministic-test guarantees", async () => {
    const [testingGuide, packageJsonText] = await Promise.all([
      readRepoFile(DOC_PATHS.testingGuide),
      readRepoFile("package.json"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as PackageJson;

    expect(testingGuide).toContain("pnpm exec playwright test");
    expect(packageJson.devDependencies).toHaveProperty("@playwright/test");

    expectContainsAll(testingGuide, [
      "Security Audit",
      "pnpm run audit",
      "pnpm run quality:guardrails",
      "global coverage threshold",
      "coverage.include",
      "src/**/*.ts",
      "lines: 77.4",
      "functions: 71.5",
      "branches: 66.1",
      "statements: 76.0",
      "src/server/activity-cache-service.ts",
      "80%",
      "test-results/",
      "playwright-report/",
      "playwright-artifacts",
      "VITEST_IN_MEMORY_DB=true",
      "withIsolatedTestHome",
      "Fake timers are not enabled globally",
    ]);
  });

  it("keeps logging docs aligned with correlation and sanitized telemetry guarantees", async () => {
    const loggingGuide = await readRepoFile(DOC_PATHS.loggingGuide);

    expectContainsAll(loggingGuide, [
      "correlationId",
      "x-correlation-id",
      "debugLogFileLevel",
      ".code-ux/debug.log",
      "`error` is the default",
      "metadata-only",
      "Logs must not include raw provider transcript text, API keys, provider environment values, or raw usage JSON payloads.",
      "deterministic counters",
      "provider_invocation_usage_updated",
    ]);
  });

  it("keeps the runbook aligned with security validation, Playwright artifacts, and activity-cache operations", async () => {
    const runbook = await readRepoFile(DOC_PATHS.runbook);

    expect(runbook).not.toContain("`npm run dev");
    expect(runbook).not.toContain("`npm start");
    expectContainsAll(runbook, [
      "pnpm run dev",
      "pnpm start",
      "pnpm run test:backend:coverage",
      "src/server/activity-cache-service.ts",
      "80% line threshold",
      "runtime.debugLogFileLevel",
      "file logging defaults to `error`",
      "Security Audit",
      "pnpm run audit",
      "pnpm exec playwright test",
      "playwright-artifacts",
      "test-results/",
      "playwright-report/",
      "mcp-http-auth-token",
    ]);
  });
});
