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
const RELEASE_INSTALL_VERIFIER = "scripts/verify-release-install.mjs";
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
    const buildJob = getJobBlock(playwright, "build");
    const testJob = getJobBlock(playwright, "test");
    const npmPackageJob = getJobBlock(playwright, "npm-package");

    expectWorkflowToolchain(playwright, "Playwright");
    expectConcurrencyCancellation(playwright, "Playwright");
    expect(playwright).toMatch(/push:\n    branches: \[main\]/);
    expect(playwright).toMatch(/pull_request:\n    branches: \[main\]/);
    expect(playwright).not.toContain("branches: [dev]");

    expect(buildJob).toContain("strategy:");
    expect(buildJob).toContain("matrix:");
    expect(buildJob).toContain("runner: ubuntu-latest");
    expect(buildJob).toContain("runner: macos-latest");
    expect(buildJob).toContain("runner: windows-latest");
    expectWorkflowStepAfter(buildJob, "Checkout repository for ${{ matrix.os.label }} build", "Set up pnpm 10.33.0 for ${{ matrix.os.label }} build");
    expectWorkflowStepAfter(buildJob, "Set up Node.js 22 for ${{ matrix.os.label }} build", "Restore node_modules cache for ${{ matrix.os.label }} build");
    expectWorkflowStepAfter(buildJob, "Restore node_modules cache for ${{ matrix.os.label }} build", "Install dependencies for ${{ matrix.os.label }} build");
    expectWorkflowStepAfter(buildJob, "Install dependencies for ${{ matrix.os.label }} build", "Restore Vite cache for ${{ matrix.os.label }} build");
    expectWorkflowStepAfter(buildJob, "Build server & dashboard (${{ matrix.os.label }})", "Verify compiled CLI exists after ${{ matrix.os.label }} build");
    expectWorkflowStepAfter(buildJob, "Verify compiled CLI exists after ${{ matrix.os.label }} build", "Upload compiled app artifact for ${{ matrix.os.label }}");
    expect(buildJob).toContain("run: pnpm run build");
    expect(buildJob).toContain("dist/");
    expect(buildJob).toContain("dashboard/dist/");
    expect(buildJob).toContain(".cache/tsc/");

    expect(testJob).toContain("needs: build");
    expect(testJob).toContain("fail-fast: false");
    expect(testJob).toContain("matrix:");
    expect(testJob).toContain("name: navigation");
    expect(testJob).toContain("name: settings");
    expect(testJob).toContain("name: projects");
    expect(testJob).toContain("name: tasks");
    expect(testJob).toContain("name: agents");
    expect(testJob).toContain("name: config");
    expectWorkflowStepAfter(
      testJob,
      "Checkout repository for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Set up pnpm 10.33.0 for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Set up Node.js 22 for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Restore node_modules cache for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Restore node_modules cache for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Install dependencies for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Install dependencies for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Download compiled app artifact for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Download compiled app artifact for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Verify restored compiled CLI for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Verify restored compiled CLI for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Cache Playwright browser binaries for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Cache Playwright browser binaries for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Install Playwright OS dependencies for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Install Playwright OS dependencies for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Install Playwright Chromium for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
    );
    expectWorkflowStepAfter(
      testJob,
      "Install Playwright Chromium for ${{ matrix.os.label }} ${{ matrix.project.label }} E2E",
      "Run E2E - ${{ matrix.project.label }} group on ${{ matrix.os.label }}",
    );
    expect(testJob).toContain("if: runner.os == 'Linux'");
    expect(testJob).toContain("run: pnpm exec playwright install-deps chromium");
    expect(testJob).toContain("run: pnpm exec playwright install chromium");
    expect(testJob).toContain("run: pnpm exec playwright test --project=${{ matrix.project.name }}");
    expect(testJob).toContain("Run E2E - ${{ matrix.project.label }} group on ${{ matrix.os.label }}");
    expect(testJob).toMatch(/- name: Upload Playwright artifacts for .* E2E\n        if: always\(\)\n        uses: actions\/upload-artifact@v4/);
    expect(testJob).toContain("test-results/");
    expect(testJob).toContain("playwright-report/");

    expect(npmPackageJob).toContain("pnpm pack --pack-destination .cache/npm-package");
    expect(npmPackageJob).toContain("pnpm add ../npm-package/*.tgz");
    expect(npmPackageJob).toContain("node .cache/npm-install-smoke/node_modules/@codeuxai/codeux/dist/index.js --help");

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
    expect(config).toContain("name: 'navigation'");
    expect(config).toContain("name: 'settings'");
    expect(config).toContain("name: 'projects'");
    expect(config).toContain("name: 'tasks'");
    expect(config).toContain("name: 'agents'");
    expect(config).toContain("name: 'config'");
    expect(config).toContain("testMatch: 'tests/e2e/navigation/**/*.spec.ts'");
    expect(config).toContain("testMatch: 'tests/e2e/settings/**/*.spec.ts'");
    expect(config).toContain("testMatch: 'tests/e2e/projects/**/*.spec.ts'");
    expect(config).toContain("testMatch: 'tests/e2e/tasks/**/*.spec.ts'");
    expect(config).toContain("testMatch: 'tests/e2e/agents/**/*.spec.ts'");
    expect(config).toContain("testMatch: 'tests/e2e/config/**/*.spec.ts'");
    expect(config).not.toContain("name: 'chromium-desktop'");
    expect(config).not.toContain("name: 'chromium-mobile'");
    expect(config).not.toContain("Pixel 5");
  });

  it("keeps mockup sprint orchestration on normal CI DAG and main-PR-only Electron DAG lanes", async () => {
    const [workflow, packageJson, runnerScript, scenarioScript] = await Promise.all([
      readRepoFile(WORKFLOWS.mockupSprintOrchestration),
      readRepoFile("package.json").then((content) => JSON.parse(content) as PackageJson),
      readRepoFile("scripts/e2e/run-mockup-sprint-pentest.mjs"),
      readRepoFile("scripts/e2e/mockup-sprint-pentest-scenarios.mjs"),
    ]);
    const dagJob = getJobBlock(workflow, "ci-dag");
    const electronJob = getJobBlock(workflow, "electron-ci-dag");
    const ciDagScript = packageJson.scripts?.["test:orchestration:ci-dag"] ?? "";
    const ciDagRunScript = packageJson.scripts?.["test:orchestration:ci-dag:run"] ?? "";
    const electronDagScript = packageJson.scripts?.["test:orchestration:ci-dag:electron"] ?? "";
    const electronDagRunScript = packageJson.scripts?.["test:orchestration:ci-dag:electron:run"] ?? "";

    expect(workflow).toContain("Mockup Sprint Orchestration");
    expectConcurrencyCancellation(workflow, "Mockup sprint orchestration");
    expect(workflow).toMatch(/push:\n    branches: \[main, dev\]/);
    expect(workflow).toMatch(/pull_request:\n    branches: \[main, dev\]/);
    expect(workflow).toContain("workflow_dispatch:");

    expect(dagJob).toContain("runs-on: ubuntu-latest");
    expect(dagJob).toContain("timeout-minutes: 25");
    expectJobToolchain(dagJob, "Mockup sprint CI DAG");
    expect(dagJob).toContain("run: pnpm run build");
    expect(dagJob).toContain("run: pnpm run test:orchestration:ci-dag:run");
    expectCommandBefore(dagJob, "run: pnpm run build", "run: pnpm run test:orchestration:ci-dag:run");
    expect(dagJob).not.toContain("container:");
    expect(dagJob).not.toContain("run: pnpm run test:orchestration:rapid");
    expect(dagJob).not.toContain("run: pnpm run test:orchestration:ci-dag:electron");
    expect(dagJob).not.toContain("run: pnpm run test:orchestration:full");
    expect(dagJob).not.toContain("test:orchestration:pentest");
    expect(dagJob).not.toContain("run-mockup-sprint-pentest.mjs --scenario pentest");
    expect(dagJob).not.toContain("pnpm run test:e2e:mockup-sprint-pentest");
    expect(dagJob).not.toContain("OPENROUTER_API_KEY");
    expect(dagJob).not.toContain("GITHUB_TOKEN");
    expect(ciDagScript).toContain("pnpm run build && pnpm run test:orchestration:ci-dag:run");
    expect(ciDagRunScript).toContain("run-mockup-sprint-pentest.mjs");
    expect(ciDagRunScript).toContain("--execution-mode docker");
    expect(ciDagRunScript).toContain("--scenario ci-small-dag");
    expect(ciDagRunScript).toContain("--stall-timeout-ms 180000");
    expect(ciDagRunScript).not.toContain("--runtime electron");

    expect(electronJob).toContain("if: github.event_name == 'pull_request' && github.base_ref == 'main'");
    expect(electronJob).toContain("timeout-minutes: 25");
    expect(electronJob).not.toContain("workflow_dispatch");
    expect(electronJob).not.toContain("refs/heads/main");
    expect(electronJob).toContain("runs-on: ${{ matrix.os }}");
    expect(electronJob).toContain("name: macOS");
    expect(electronJob).toContain("os: macos-latest");
    expect(electronJob).toContain("name: Windows");
    expect(electronJob).toContain("os: windows-latest");
    expect(electronJob).toContain("CSC_IDENTITY_AUTO_DISCOVERY: \"false\"");
    expect(electronJob).toContain("GH_TOKEN: \"\"");
    expect(electronJob).toContain("electron_config_cache: ${{ github.workspace }}/.cache/electron-downloads");
    expect(electronJob).toContain("uses: actions/cache@v5");
    expectJobToolchain(electronJob, "Mockup sprint main Electron DAG");
    expect(electronJob).toContain("- name: Restore Electron binary cache");
    expectCacheKey(electronJob, "-electron-binary-", ["pnpm-lock.yaml"]);
    expect(electronJob).toContain("${{ runner.os }}-node22-pnpm10.33.0-electron-binary-");
    expect(electronJob).toContain("run: node node_modules/electron/install.js");
    expect(electronJob).toContain("run: pnpm run electron:install-deps");
    expect(electronJob).toContain("run: pnpm run build");
    expectCommandBefore(electronJob, "run: pnpm install --frozen-lockfile --ignore-scripts", "run: node node_modules/electron/install.js");
    expectCommandBefore(electronJob, "run: node node_modules/electron/install.js", "run: pnpm run electron:install-deps");
    expectCommandBefore(electronJob, "run: pnpm run electron:install-deps", "run: pnpm run build");
    expectCommandBefore(electronJob, "run: pnpm run build", "run: pnpm run test:orchestration:ci-dag:electron:run");
    expect(electronJob).toContain("run: pnpm run test:orchestration:ci-dag:electron:run");
    expect(electronJob).not.toContain("container:");
    expect(electronJob).not.toMatch(/^\s*run: pnpm run test:orchestration:ci-dag$/m);
    expect(electronJob).not.toContain("run: pnpm run test:orchestration:rapid");
    expect(electronJob).not.toContain("OPENROUTER_API_KEY");
    expect(electronJob).not.toContain("GITHUB_TOKEN");
    expect(electronDagScript).toContain("pnpm run build && pnpm run test:orchestration:ci-dag:electron:run");
    expect(electronDagRunScript).toContain("run-mockup-sprint-pentest.mjs");
    expect(electronDagRunScript).toContain("--runtime electron");
    expect(electronDagRunScript).toContain("--execution-mode fixture");
    expect(electronDagRunScript).toContain("--scenario ci-small-dag-electron");
    expect(electronDagRunScript).toContain("--stall-timeout-ms 180000");

    const runnerBeforeElectronStart = runnerScript.slice(0, runnerScript.indexOf("async function startElectronCodeUx"));
    expect(runnerBeforeElectronStart).not.toContain('from "@playwright/test"');
    expect(runnerBeforeElectronStart).not.toContain('from "electron"');
    expect(runnerScript).toContain('import("@playwright/test")');
    expect(runnerScript).toContain('import("electron")');
    expect(runnerScript).toContain("const DEFAULT_STALL_TIMEOUT_MS = 3 * 60 * 1000");
    expect(runnerScript).toContain("const HTTP_REQUEST_TIMEOUT_MS = 60_000");
    expect(runnerScript).toContain("--stall-timeout-ms");
    expect(runnerScript).toContain("timed out after ${timeoutMs}ms before reaching a terminal summary");
    expect(runnerScript).toContain("mockup_pentest_progress");
    expect(runnerScript).toContain("mockup_pentest_stalled");
    expect(runnerScript).toContain("GITHUB_STEP_SUMMARY");
    expect(runnerScript).toContain("writeRuntimeLogToConsole");

    const ciDagValidationTask = scenarioScript.slice(
      scenarioScript.indexOf('key: "ci-dag-validation"'),
      scenarioScript.indexOf("return tasks;", scenarioScript.indexOf('key: "ci-dag-validation"')),
    );
    expect(ciDagValidationTask).toContain('dependsOn: ["ci-dag-batch-01", "ci-dag-batch-02"]');
    expect(ciDagValidationTask).toContain('"test/run-validation.mjs"');
    expect(ciDagValidationTask).not.toContain('run("node test/run-validation.mjs")');
    expect(scenarioScript).toContain('commands: [{ command: "node test/run-validation.mjs", exitCode: 0 }]');
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

  it("keeps the release install verifier pinned to the locally installed CLI bin", async () => {
    const verifier = await readRepoFile(RELEASE_INSTALL_VERIFIER);

    expect(verifier).toContain('path.join(installDir, "node_modules", ".bin", binName)');
    expect(verifier).toContain('installedPackagePath("package.json")');
    expect(verifier).toContain("process.execPath");
    expect(verifier).not.toContain('"exec"');
    expect(verifier).not.toContain("'exec'");
  });
});
