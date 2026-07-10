import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type CoverageThresholds = {
  lines: string;
  functions: string;
  branches: string;
  statements: string;
  activityCacheLines: string;
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

function expectRegexMatch(content: string, pattern: RegExp, label: string): RegExpMatchArray {
  const match = content.match(pattern);
  expect(match, `Missing ${label}`).not.toBeNull();
  return match as RegExpMatchArray;
}

function parseVitestCoverageThresholds(configText: string): CoverageThresholds {
  return {
    lines: expectRegexMatch(configText, /lines:\s*([0-9.]+),/, "global line threshold")[1] ?? "",
    functions: expectRegexMatch(configText, /functions:\s*([0-9.]+),/, "global function threshold")[1] ?? "",
    branches: expectRegexMatch(configText, /branches:\s*([0-9.]+),/, "global branch threshold")[1] ?? "",
    statements: expectRegexMatch(configText, /statements:\s*([0-9.]+),/, "global statement threshold")[1] ?? "",
    activityCacheLines: expectRegexMatch(
      configText,
      /"src\/server\/activity-cache-service\.ts":\s*{\s*lines:\s*([0-9.]+),/s,
      "activity cache line threshold",
    )[1] ?? "",
  };
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

  it("keeps testing docs aligned with real commands, CI, coverage, Playwright, and deterministic-test guarantees", async () => {
    const [testingGuide, packageJsonText, vitestConfig, playwrightConfig, ciWorkflow, playwrightWorkflow] = await Promise.all([
      readRepoFile(DOC_PATHS.testingGuide),
      readRepoFile("package.json"),
      readRepoFile("vitest.config.ts"),
      readRepoFile("playwright.config.ts"),
      readRepoFile(".github/workflows/ci.yml"),
      readRepoFile(".github/workflows/playwright.yml"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as PackageJson;
    const scripts = packageJson.scripts ?? {};
    const thresholds = parseVitestCoverageThresholds(vitestConfig);

    const documentedCommands = [
      "pnpm run lint",
      "pnpm run test:backend",
      "pnpm run test:dashboard",
      "pnpm run test:backend:coverage",
      "pnpm exec playwright test",
      "pnpm run build",
      "pnpm run ci",
    ];
    expectContainsAll(testingGuide, documentedCommands);
    expect(scripts.lint).toContain("tsc --noEmit");
    expect(scripts["test:backend"]).toBe("vitest run tests/backend");
    expect(scripts["test:dashboard"]).toBe("vitest run tests/dashboard");
    expect(scripts["test:backend:coverage"]).toBe("vitest run tests/backend --coverage");
    expect(scripts.build).toBe("node scripts/build.mjs");
    expect(scripts.ci).toContain("pnpm run audit");
    expect(scripts.ci).toContain("pnpm run test:backend:coverage");
    expect(scripts.ci).toContain("pnpm run test:dashboard");
    expect(scripts.ci).toContain("pnpm run build");

    expect(scripts.audit).toBe("pnpm audit --audit-level=high");
    expect(ciWorkflow).toContain("name: 04 Security / dependency audit");
    expect(ciWorkflow).toContain("run: pnpm run audit");
    const ciBuildJob = expectRegexMatch(ciWorkflow, /  build:\n[\s\S]*?\n  backend-tests:/, "CI build job")[0];
    expect(ciBuildJob).not.toContain("pnpm run audit");
    expect(playwrightWorkflow).not.toContain("pnpm run audit");
    expect(ciWorkflow).toContain("name: codeux-build-linux");

    expect(playwrightConfig).toContain("outputDir: 'test-results'");
    expect(playwrightConfig).toContain("outputFolder: 'playwright-report'");
    expect(ciWorkflow).toContain("name: playwright-${{ matrix.os.runner }}-${{ matrix.project }}");
    expect(playwrightWorkflow).toContain("name: playwright-diagnostic-${{ matrix.os.runner }}-${{ matrix.project }}");
    expect(playwrightWorkflow).toContain("test-results/");
    expect(playwrightWorkflow).toContain("playwright-report/");
    expect(testingGuide).toContain("test-results/");
    expect(testingGuide).toContain("playwright-report/");
    expect(testingGuide).toContain("playwright-<runner>-<purpose>");
    expect(testingGuide).toContain("playwright-diagnostic-<runner>-<purpose>");

    expect(packageJson.devDependencies).toHaveProperty("@playwright/test");

    expectContainsAll(testingGuide, [
      "04 Security / dependency audit",
      "pnpm run audit",
      "pnpm run quality:guardrails",
      "global coverage threshold",
      "coverage.include",
      "src/**/*.ts",
      `Lines | \`${thresholds.lines}\``,
      `Functions | \`${thresholds.functions}\``,
      `Branches | \`${thresholds.branches}\``,
      `Statements | \`${thresholds.statements}\``,
      "src/server/activity-cache-service.ts",
      `lines: ${thresholds.activityCacheLines}`,
      "ratchet-only",
      "never lower",
      "VITEST_IN_MEMORY_DB=true",
      "TZ=UTC",
      "LANG=C.UTF-8",
      "LC_ALL=C.UTF-8",
      "withIsolatedTestHome",
      "Fake timers are not enabled globally",
      "Docker, Git, provider CLI/API, subprocess",
    ]);
  });

  it("keeps logging docs aligned with correlation and sanitized telemetry guarantees", async () => {
    const loggingGuide = await readRepoFile(DOC_PATHS.loggingGuide);

    expectContainsAll(loggingGuide, [
      "correlationId",
      "x-correlation-id",
      "logPurpose",
      "`HTTP`",
      "`INVK`",
      "`LIVE`",
      "`SEC`",
      "DEBUG_LOG_FILE_LEVEL",
      "debugLogFileLevel",
      ".code-ux/debug.log",
      "`error` is the default",
      "metadata-only",
      "Logs must not include raw provider transcript text, API keys, provider environment values, or raw usage JSON payloads.",
      "deterministic counters",
      "provider_invocation_usage_updated",
      "rawUsageJsonPresent",
      "Realtime logs must use `logPurpose: \"realtime\"`",
      "Security validation failures should log through `logPurpose: \"security\"`",
    ]);
  });

  it("keeps the runbook aligned with security validation, Playwright artifacts, and activity-cache operations", async () => {
    const [runbook, packageJsonText, playwrightWorkflow] = await Promise.all([
      readRepoFile(DOC_PATHS.runbook),
      readRepoFile("package.json"),
      readRepoFile(".github/workflows/playwright.yml"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as PackageJson;

    expect(runbook).not.toContain("`npm run dev");
    expect(runbook).not.toContain("`npm start");
    expect(packageJson.scripts?.audit).toBe("pnpm audit --audit-level=high");
    expect(playwrightWorkflow).toContain("retention-days: 7");
    expectContainsAll(runbook, [
      "pnpm run dev",
      "pnpm start",
      "pnpm run test:backend:coverage",
      "src/server/activity-cache-service.ts",
      "80% line threshold",
      "runtime.debugLogFileLevel",
      "file logging defaults to `error`",
      "04 Security / dependency audit",
      "pnpm run audit",
      "pnpm audit --audit-level=high",
      "pnpm exec playwright test",
      "playwright-<runner>-<purpose>",
      "playwright-diagnostic-<runner>-<purpose>",
      "test-results/",
      "playwright-report/",
      "artifact retention window is seven days",
      "workflow concurrency groups",
      "Security validation is intentionally separated from build and Playwright lanes",
      "structured `logPurpose` label",
      "Realtime event logs are operational metadata",
      "metadata-only",
      "mcp-http-auth-token",
    ]);
  });
});
