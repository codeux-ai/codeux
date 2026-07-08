import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = {
  ci: ".github/workflows/ci.yml",
  desktopRelease: ".github/workflows/desktop-release.yml",
  release: ".github/workflows/release.yml",
  playwright: ".github/workflows/playwright.yml",
  releaseChecks: ".github/workflows/release-checks.yml",
  openrouterSprintE2e: ".github/workflows/openrouter-sprint-e2e.yml",
  mockupSprintOrchestration: ".github/workflows/mockup-sprint-orchestration.yml",
} as const;

const PLAYWRIGHT_CONFIG = "playwright.config.ts";
const REQUIRED_INSTALL = "pnpm install --frozen-lockfile --ignore-scripts";
const PACKAGE_MANAGER_VERSION = "10.33.0";
const NODE_VERSION = "22";

type PackageJson = {
  packageManager?: string;
  engines?: {
    node?: string;
  };
  scripts?: Record<string, string>;
};

async function readRepoFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

function getJobBlock(workflow: string, jobName: string): string {
  const pattern = new RegExp(`^  ${jobName}:\\n(?<block>(?: {4}.*\\n|\\n)+)`, "m");
  const match = pattern.exec(workflow);
  const block = match?.groups?.block;

  expect(block, `Expected workflow job "${jobName}" to exist`).toBeDefined();
  return block ?? "";
}

function expectWorkflowToolchain(workflow: string, label: string): void {
  expect(workflow, `${label} should pin pnpm/action-setup`).toMatch(/uses: pnpm\/action-setup@v\d+/);
  expect(workflow, `${label} should pin pnpm version`).toMatch(/version: 10\.33\.0/);
  expect(workflow, `${label} should disable action-driven installs`).toContain("run_install: false");
  expect(workflow, `${label} should pin setup-node`).toMatch(/uses: actions\/setup-node@v\d+/);
  expect(workflow, `${label} should pin Node 22`).toMatch(/node-version: 22/);
  expect(workflow, `${label} should use frozen lockfile installs without lifecycle scripts`).toContain(REQUIRED_INSTALL);
}

function expectJobToolchain(job: string, label: string): void {
  expect(job, `${label} should pin pnpm/action-setup`).toMatch(/uses: pnpm\/action-setup@v\d+/);
  expect(job, `${label} should pin pnpm version`).toMatch(/version: 10\.33\.0/);
  expect(job, `${label} should disable action-driven installs`).toContain("run_install: false");
  expect(job, `${label} should pin setup-node`).toMatch(/uses: actions\/setup-node@v\d+/);
  expect(job, `${label} should pin Node 22`).toMatch(/node-version: 22/);
  expect(job, `${label} should use frozen lockfile installs without lifecycle scripts`).toContain(REQUIRED_INSTALL);
}

function expectConcurrencyCancellation(workflow: string, label: string): void {
  expect(workflow, `${label} should cancel superseded workflow runs`).toMatch(/concurrency:\n(?:  .+\n)*  cancel-in-progress: true/);
}

function expectCacheKey(workflow: string, cacheName: string, requiredInputs: string[]): void {
  const keyLine = workflow
    .split("\n")
    .find((line) => line.includes("key:") && line.includes(cacheName));

  expect(keyLine, `Expected ${cacheName} cache key`).toBeDefined();
  expect(keyLine, `${cacheName} should include runner OS`).toContain("${{ runner.os }}");
  expect(keyLine, `${cacheName} should include Node 22`).toContain("node22");
  expect(keyLine, `${cacheName} should include pnpm 10.33.0`).toContain("pnpm10.33.0");

  for (const input of requiredInputs) {
    expect(keyLine, `${cacheName} should hash ${input}`).toContain(input);
  }
}

function expectJobRunsCommandIndependently(workflow: string, jobName: string, command: string): void {
  const job = getJobBlock(workflow, jobName);

  expect(job).toContain(`run: ${command}`);
  expect(job, `${jobName} should be an independent job without a needs dependency`).not.toMatch(/^    needs:/m);
}

function expectJobDoesNotRunCommand(workflow: string, jobName: string, command: string): void {
  expect(getJobBlock(workflow, jobName), `${jobName} should not run ${command}`).not.toContain(`run: ${command}`);
}

function expectCommandBefore(workflow: string, before: string, after: string): void {
  const beforeIndex = workflow.indexOf(before);
  const afterIndex = workflow.indexOf(after);

  expect(beforeIndex, `Expected to find "${before}"`).toBeGreaterThanOrEqual(0);
  expect(afterIndex, `Expected to find "${after}"`).toBeGreaterThanOrEqual(0);
  expect(beforeIndex, `"${before}" should appear before "${after}"`).toBeLessThan(afterIndex);
}

function expectWorkflowStepAfter(workflow: string, firstStepName: string, secondStepName: string): void {
  expectCommandBefore(workflow, `- name: ${firstStepName}`, `- name: ${secondStepName}`);
}

function expectPinnedMajorActionVersions(workflow: string, label: string): void {
  const actionUses = workflow.match(/uses:\s*[^@\s]+@[^\s]+/g) ?? [];

  expect(actionUses.length, `${label} should use GitHub Actions`).toBeGreaterThan(0);
  for (const actionUse of actionUses) {
    expect(actionUse, `${label} should pin action versions to an explicit major version`).toMatch(/@v\d+$/);
  }
}

function expectNoBroadWorkflowPermissions(workflow: string, label: string): void {
  expect(workflow, `${label} should declare explicit workflow or job permissions`).toContain("permissions:");
  expect(workflow, `${label} should not request write-all permissions`).not.toMatch(/permissions:\s*write-all/);
  expect(workflow, `${label} should not grant actions write permissions`).not.toMatch(/actions:\s*write/);
  expect(workflow, `${label} should not grant packages write permissions`).not.toMatch(/packages:\s*write/);
  expect(workflow, `${label} should not grant pull request write permissions`).not.toMatch(/pull-requests:\s*write/);
}

describe("GitHub workflow health", () => {
  it("keeps package toolchain policy pinned to pnpm 10.33.0 and Node 22", async () => {
    const packageJson = JSON.parse(await readRepoFile("package.json")) as PackageJson;

    expect(packageJson.packageManager).toBe(`pnpm@${PACKAGE_MANAGER_VERSION}`);
    expect(packageJson.engines?.node).toBe(`>=${NODE_VERSION}`);
    expect(packageJson.scripts?.audit).toBe("pnpm audit --audit-level=high");
  });

  it("keeps core CI split into auditable jobs with independent security audit", async () => {
    const ci = await readRepoFile(WORKFLOWS.ci);

    expectWorkflowToolchain(ci, "CI");
    expectConcurrencyCancellation(ci, "CI");

    for (const jobName of ["typecheck", "test-backend", "test-dashboard", "build", "security-audit"]) {
      expect(getJobBlock(ci, jobName)).toContain("runs-on: ubuntu-latest");
    }

    expectJobRunsCommandIndependently(ci, "security-audit", "pnpm run audit");
    expectJobToolchain(getJobBlock(ci, "security-audit"), "CI security audit");
    for (const jobName of ["typecheck", "test-backend", "test-dashboard", "build"]) {
      expectJobDoesNotRunCommand(ci, jobName, "pnpm run audit");
    }
    expect(getJobBlock(ci, "typecheck")).toContain("pnpm run quality:guardrails");
    expect(getJobBlock(ci, "typecheck")).toContain("pnpm run typecheck");
    expect(getJobBlock(ci, "test-backend")).toContain("pnpm run test:backend:coverage");
    expect(getJobBlock(ci, "test-dashboard")).toContain("pnpm run test:dashboard");
    expect(getJobBlock(ci, "build")).toContain("pnpm run build");
  });

  it("keeps security-relevant workflows on least-privilege permissions and pinned major actions", async () => {
    const workflows = await Promise.all(
      Object.entries(WORKFLOWS).map(async ([label, workflowPath]) => [
        label,
        await readRepoFile(workflowPath),
      ] as const),
    );

    for (const [label, workflow] of workflows) {
      expectPinnedMajorActionVersions(workflow, label);
      expectNoBroadWorkflowPermissions(workflow, label);
    }

    expect(await readRepoFile(WORKFLOWS.release)).toMatch(/permissions:\n      contents: read\n      id-token: write/);
    expect(await readRepoFile(WORKFLOWS.desktopRelease)).toMatch(/permissions:\n  contents: write/);
  });

  it("keeps dependency-risk workflows running audit after script-free installs", async () => {
    const [ci, release, releaseChecks, desktopRelease] = await Promise.all([
      readRepoFile(WORKFLOWS.ci),
      readRepoFile(WORKFLOWS.release),
      readRepoFile(WORKFLOWS.releaseChecks),
      readRepoFile(WORKFLOWS.desktopRelease),
    ]);

    expect(getJobBlock(ci, "security-audit")).toContain("run: pnpm run audit");

    for (const [label, workflow] of [
      ["release", release],
      ["releaseChecks", releaseChecks],
      ["desktopRelease", desktopRelease],
    ] as const) {
      expect(workflow, `${label} should install dependencies without lifecycle scripts`).toContain(REQUIRED_INSTALL);
      expect(workflow, `${label} should audit release dependencies`).toContain("run: pnpm run audit");
      expectCommandBefore(workflow, "run: pnpm install --frozen-lockfile --ignore-scripts", "run: pnpm run audit");
    }
  });

  it("keeps CI cache keys stable and tied to dependency and config hashes", async () => {
    const ci = await readRepoFile(WORKFLOWS.ci);

    expectCacheKey(ci, "-nm-", ["package.json", "pnpm-lock.yaml"]);
    expectCacheKey(ci, "-tsc-", ["package.json", "pnpm-lock.yaml", "tsconfig.json", "dashboard/tsconfig.json"]);
    expectCacheKey(ci, "-vitest-backend-", ["package.json", "pnpm-lock.yaml", "vitest.config.ts"]);
    expectCacheKey(ci, "-vitest-dashboard-", ["package.json", "pnpm-lock.yaml", "vitest.config.ts"]);
    expectCacheKey(ci, "-vite-build-", ["package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json", "dashboard/tsconfig.json"]);
  });

  it("keeps Playwright as a release-path E2E lane with build, browser install, and artifacts", async () => {
    const playwright = await readRepoFile(WORKFLOWS.playwright);
    const playwrightJob = getJobBlock(playwright, "test-e2e");

    expectWorkflowToolchain(playwright, "Playwright");
    expectConcurrencyCancellation(playwright, "Playwright");
    expect(playwright).toMatch(/push:\n    branches: \[main\]/);
    expect(playwright).toMatch(/pull_request:\n    branches: \[main\]/);
    expect(playwright).not.toContain("branches: [dev]");

    expectCommandBefore(playwright, "run: pnpm run build", "run: pnpm run test:e2e");
    expectWorkflowStepAfter(playwrightJob, "Build server & dashboard", "Run Playwright E2E Tests");
    expectWorkflowStepAfter(playwrightJob, "Cache Playwright browser binaries", "Install Playwright browsers");
    expectWorkflowStepAfter(playwrightJob, "Install Playwright browsers", "Run Playwright E2E Tests");
    expect(playwrightJob).toContain("if: runner.os == 'Linux'");
    expect(playwrightJob).toContain("run: pnpm exec playwright install-deps chromium");
    expect(playwrightJob).toContain("run: pnpm exec playwright install chromium");
    expect(playwrightJob).toMatch(/- name: Upload Playwright artifacts\n        if: always\(\)\n        uses: actions\/upload-artifact@v4/);
    expect(playwrightJob).toContain("test-results/");
    expect(playwrightJob).toContain("playwright-report/");

    expectCacheKey(playwright, "-nm-", ["package.json", "pnpm-lock.yaml"]);
    expectCacheKey(playwright, "-vite-e2e-", ["package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json", "dashboard/tsconfig.json"]);
    expectCacheKey(playwright, "-playwright-", ["package.json", "pnpm-lock.yaml"]);
  });

  it("keeps Playwright config isolated, serialized, and failure-artifact friendly", async () => {
    const config = await readRepoFile(PLAYWRIGHT_CONFIG);

    expect(config).toContain("command: 'node dist/index.js'");
    expect(config).toContain("process.env.CODEUX_E2E_DASHBOARD_PORT || process.env.DASHBOARD_PORT || '4464'");
    expect(config).toContain("const resolvedDashboardPort = Number.isFinite(dashboardPort) ? dashboardPort : 4464;");
    expect(config).toContain("const dashboardBaseUrl = `http://127.0.0.1:${resolvedDashboardPort}`;");
    expect(config).toContain("baseURL: dashboardBaseUrl");
    expect(config).toContain("url: `${dashboardBaseUrl}/health`");
    expect(config).toContain("const chromiumExecutablePath = (() => {");
    expect(config).toContain("launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,");
    expect(config).toContain("CODE_UX_DIRECTORY_BROWSER_ROOTS: os.tmpdir()");
    expect(config).toContain("DASHBOARD_PORT: String(resolvedDashboardPort)");
    expect(config).toContain("CODEUX_E2E_DASHBOARD_PORT");
    expect(config).toContain("CODEUX_E2E_PROVIDER_CLI_SHIM: mockProviderCliPath");
    expect(config).toContain("MCP_HTTP_PORT: String(resolvedDashboardPort + 1)");
    expect(config).toContain("CODE_UX_CONTAINERIZED_GIT: '0'");
    expect(config).toContain("CODE_UX_GIT_CONTAINER_MODE: 'host'");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("workers: 1");
    expect(config).toContain("trace: 'retain-on-failure'");
    expect(config).toContain("screenshot: 'only-on-failure'");
    expect(config).toContain("video: 'retain-on-failure'");
    expect(config).toContain("HOME: tempHome");
    expect(config).toContain("USERPROFILE: tempHome");
    expect(config).toContain("name: 'chromium-desktop'");
    expect(config).toContain("name: 'chromium-mobile'");
    expect(config).toContain("testMatch: /sprint-ledger-responsive\\.spec\\.ts/");
    expect(config).toContain("...devices['Pixel 5']");
  });

  it("keeps mockup sprint orchestration on a Docker-backed no-secret Linux CI lane", async () => {
    const workflow = await readRepoFile(WORKFLOWS.mockupSprintOrchestration);
    const job = getJobBlock(workflow, "mockup-sprint-orchestration");

    expect(workflow).toContain("Mockup Sprint Orchestration");
    expectConcurrencyCancellation(workflow, "Mockup sprint orchestration");
    expect(workflow).toMatch(/push:\n    branches: \[main, dev\]/);
    expect(workflow).toMatch(/pull_request:\n    branches: \[main, dev\]/);
    expect(workflow).toContain("workflow_dispatch:");

    expect(job).toContain("runs-on: ubuntu-latest");
    expect(job).toContain("uses: pnpm/action-setup@v6");
    expect(job).toContain("version: 10.33.0");
    expect(job).toContain("run_install: false");
    expect(job).toContain("uses: actions/setup-node@v5");
    expect(job).toContain("node-version: 22");
    expect(job).toContain("run: pnpm install --frozen-lockfile --ignore-scripts");
    expect(job).toContain("docker version");
    expect(job).toContain("Docker is required for the mockup sprint orchestration lane.");
    expect(job).toContain("run: pnpm run test:orchestration:full");
    expect(job).not.toContain("run: pnpm run build");
    expect(job).not.toContain("test:orchestration:pentest");
    expect(job).not.toContain("run-mockup-sprint-pentest.mjs --scenario pentest");
    expectCommandBefore(job, "docker version", "run: pnpm run test:orchestration:full");

    expect(job).toMatch(/if: \$\{\{ failure\(\) \|\| hashFiles\('\.cache\/e2e-mockup-sprint-pentest\/\*\*'\) != '' \}\}/);
    expect(job).toContain("uses: actions/upload-artifact@v4");
    expect(job).toContain("path: .cache/e2e-mockup-sprint-pentest/");
    expect(job).toContain("include-hidden-files: true");
    expect(job).toContain("retention-days: 5");
    expect(job).not.toContain("OPENROUTER_API_KEY");
    expect(job).not.toContain("GITHUB_TOKEN");
  });

  it("keeps release checks separate from CI and Playwright validation lanes", async () => {
    const [ci, playwright, releaseChecks] = await Promise.all([
      readRepoFile(WORKFLOWS.ci),
      readRepoFile(WORKFLOWS.playwright),
      readRepoFile(WORKFLOWS.releaseChecks),
    ]);

    expect(ci).not.toContain("pnpm run test:e2e");
    expect(playwright).not.toContain("pnpm run audit");
    expect(playwright).not.toContain("electron:dist");

    expectWorkflowToolchain(releaseChecks, "Release checks");
    expectConcurrencyCancellation(releaseChecks, "Release checks");
    expect(releaseChecks).toMatch(/pull_request:\n    branches:\n      - main/);
    expect(releaseChecks).toContain("workflow_dispatch:");
    expect(releaseChecks).toContain("pnpm run build");
    expect(releaseChecks).toContain("node scripts/verify-release-install.mjs");
    expectCommandBefore(releaseChecks, "run: pnpm run audit", "run: pnpm run build");
    expect(releaseChecks).toContain("pnpm run electron:install-deps");
    expectCommandBefore(releaseChecks, "run: pnpm install --frozen-lockfile --ignore-scripts", "run: pnpm run electron:install-deps");
    expect(releaseChecks).toContain("pnpm run ${{ matrix.electron-script }} -- --publish never");
    expectCacheKey(releaseChecks, "-release-checks-", [
      "package.json",
      "pnpm-lock.yaml",
      "vite.config.ts",
      "tsconfig.json",
      "dashboard/tsconfig.json",
      "electron-builder.config.cjs",
      "scripts/prepare-electron-runtime-deps.mjs",
      "scripts/verify-release-install.mjs",
    ]);
  });
});
