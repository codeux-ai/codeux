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

function expectConcurrencyCancellation(workflow: string, label: string): void {
  expect(workflow, `${label} should cancel superseded workflow runs`).toMatch(/concurrency:\n(?:  .+\n)*  cancel-in-progress: true/);
}

function expectCommandBefore(workflow: string, before: string, after: string): void {
  const beforeIndex = workflow.indexOf(before);
  const afterIndex = workflow.indexOf(after);

  expect(beforeIndex, `Expected to find "${before}"`).toBeGreaterThanOrEqual(0);
  expect(afterIndex, `Expected to find "${after}"`).toBeGreaterThanOrEqual(0);
  expect(beforeIndex, `"${before}" should appear before "${after}"`).toBeLessThan(afterIndex);
}

function expectManualOnly(workflow: string, label: string): void {
  expect(workflow, `${label} should stay manually runnable`).toContain("workflow_dispatch:");
  expect(workflow, `${label} should not run automatically on pushes`).not.toMatch(/\n  push:/);
  expect(workflow, `${label} should not run automatically on pull requests`).not.toMatch(/\n  pull_request:/);
}

describe("GitHub workflow health", () => {
  it("keeps package toolchain policy pinned to pnpm 10.33.0 and Node 22", async () => {
    const packageJson = JSON.parse(await readRepoFile("package.json")) as PackageJson;

    expect(packageJson.packageManager).toBe(`pnpm@${PACKAGE_MANAGER_VERSION}`);
    expect(packageJson.engines?.node).toBe(`>=${NODE_VERSION}`);
    expect(packageJson.scripts?.audit).toBe("pnpm audit --audit-level=high");
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

    expect(await readRepoFile(WORKFLOWS.release)).toMatch(/id-token: write/);
    expect(await readRepoFile(WORKFLOWS.release)).toMatch(/contents: write/);
    expect(await readRepoFile(WORKFLOWS.desktopRelease)).toMatch(/permissions:\n  contents: read/);
  });

  it("defines one numbered automatic CI pipeline with a strict main release version gate", async () => {
    const ci = await readRepoFile(WORKFLOWS.ci);
    const preflight = getJobBlock(ci, "preflight");

    expect(ci).toContain("name: Code UX CI Pipeline");
    expect(ci).toMatch(/push:\n    branches: \[main, dev\]/);
    expect(ci).toMatch(/pull_request:\n    branches: \[\"\*\*\"\]/);
    expect(ci).toContain("workflow_dispatch:");
    expectConcurrencyCancellation(ci, "CI");

    for (const [jobName, displayName] of [
      ["preflight", "01 Preflight / release policy"],
      ["static", "02 Static / typecheck and guardrails"],
      ["build", "03 Build / server and dashboard artifact"],
      ["backend-tests", "04 Test / backend coverage"],
      ["dashboard-tests", "05 Test / dashboard suite"],
      ["security-audit", "06 Security / dependency audit"],
      ["package-smoke", "07 Package / npm install smoke"],
      ["ci-dag", "08 Orchestration / ${{ matrix.name }} DAG"],
      ["e2e", "09 E2E /"],
      ["release-candidate", "10 Release Candidate / desktop package"],
    ] as const) {
      expect(getJobBlock(ci, jobName)).toContain(`name: ${displayName}`);
    }

    expect(preflight).toContain('BASE_REF}" != "main"');
    expect(preflight).toContain("Main release PRs must bump package.json version above");
    expect(preflight).not.toContain("package.json was not changed; skipping release version bump check.");
    expect(preflight).not.toContain("git diff --name-only");
  });

  it("runs fast core CI first and reuses a single build artifact for downstream lanes", async () => {
    const ci = await readRepoFile(WORKFLOWS.ci);
    const staticJob = getJobBlock(ci, "static");
    const buildJob = getJobBlock(ci, "build");
    const backendJob = getJobBlock(ci, "backend-tests");
    const dashboardJob = getJobBlock(ci, "dashboard-tests");
    const securityJob = getJobBlock(ci, "security-audit");
    const packageJob = getJobBlock(ci, "package-smoke");
    const dagJob = getJobBlock(ci, "ci-dag");

    for (const job of [staticJob, buildJob, backendJob, dashboardJob, securityJob]) {
      expect(job).toContain("needs: preflight");
      expect(job).toContain(REQUIRED_INSTALL);
      expect(job).toContain("node-version: ${{ env.NODE_VERSION }}");
      expect(job).toContain("version: ${{ env.PNPM_VERSION }}");
      expect(job).toContain("run_install: false");
    }

    expect(staticJob).toContain("pnpm run quality:guardrails");
    expect(staticJob).toContain("pnpm run typecheck");
    expect(staticJob).toContain("pnpm run typecheck:dashboard");
    expect(buildJob).toContain("pnpm run build");
    expect(buildJob).toContain("name: codeux-build-linux");
    expect(buildJob).toContain("dist/");
    expect(buildJob).toContain("dashboard/dist/");
    expect(backendJob).toContain("pnpm run test:backend:coverage");
    expect(dashboardJob).toContain("pnpm run test:dashboard");
    expect(securityJob).toContain("pnpm run audit");

    expect(packageJob).toContain("needs: [static, build, backend-tests, dashboard-tests, security-audit]");
    expect(packageJob).toContain("name: codeux-build-linux");
    expect(packageJob).toContain("node scripts/verify-release-install.mjs");
    expect(packageJob).toContain('CODE_UX_SKIP_RELEASE_INSTALL_BUILD: "1"');
    expect(dagJob).toContain("needs: [static, build, backend-tests, dashboard-tests, security-audit]");
    expect(dagJob).toContain("runs-on: ${{ matrix.os }}");
    expect(dagJob).toContain("max-parallel: 2");
    expect(dagJob).toContain("name: Linux Docker");
    expect(dagJob).toContain("os: ubuntu-latest");
    expect(dagJob).toContain("runtime: docker");
    expect(dagJob).toContain("pnpm run test:orchestration:ci-dag:run");
    expect(dagJob).toContain("name: macOS Electron");
    expect(dagJob).toContain("os: macos-latest");
    expect(dagJob).toContain("runtime: electron");
    expect(dagJob).toContain("name: Windows Electron");
    expect(dagJob).toContain("os: windows-latest");
    expect(dagJob).toContain("pnpm run test:orchestration:ci-dag:electron:run");
    expect(dagJob).toContain("node node_modules/electron/install.js");
    expect(dagJob).toContain("pnpm run electron:install-deps");
    expect(dagJob).toContain("name: ${{ matrix.artifact }}");
    expect(dagJob).toContain(".cache/e2e-mockup-sprint-pentest/");
  });

  it("runs release-candidate packaging beside E2E while keeping each matrix bounded", async () => {
    const ci = await readRepoFile(WORKFLOWS.ci);
    const e2e = getJobBlock(ci, "e2e");
    const releaseCandidate = getJobBlock(ci, "release-candidate");

    expect(e2e).toContain("name: 09 E2E / ${{ matrix.os.label }} full (${{ matrix.project }})");
    expect(e2e).toContain("runs-on: ${{ matrix.os.runner }}");
    expect(e2e).toContain("max-parallel: 3");
    expect(e2e).toContain("runner: ubuntu-latest");
    expect(e2e).toContain("label: Linux");
    expect(e2e).toContain("runner: macos-latest");
    expect(e2e).toContain("label: macOS");
    expect(e2e).toContain("runner: windows-latest");
    expect(e2e).toContain("label: Windows");
    expect(e2e).toContain("project: [navigation, settings, projects, tasks, agents, config]");
    expect(e2e).toContain("if: runner.os != 'Windows'");
    expect(e2e).toContain("if: runner.os == 'Linux'");
    expect(e2e).toContain("pnpm exec playwright install-deps chromium");
    expect(e2e).toContain("pnpm exec playwright test --project=${{ matrix.project }}");
    expect(e2e).toContain("name: playwright-${{ matrix.os.runner }}-${{ matrix.project }}");
    expect(e2e).toContain("playwright-report/");
    expect(ci).not.toContain("e2e-native-smoke:");
    expect(ci).not.toContain("E2E / Linux full");
    expect(ci).not.toContain("E2E / ${{ matrix.os.label }} smoke");
    expect(ci).not.toContain("electron-dag:");

    expect(releaseCandidate).toContain("needs: package-smoke");
    expect(releaseCandidate).not.toContain("ci-dag");
    expect(releaseCandidate).not.toContain("e2e");
    expect(releaseCandidate).toContain("max-parallel: 2");
    expect(releaseCandidate).toContain("node node_modules/electron/install.js");
    expect(releaseCandidate).toContain("pnpm run electron:prepare-deps");
    expect(releaseCandidate).toContain("pnpm exec electron-builder --config electron-builder.config.cjs ${{ matrix.electron-target }} --publish never");
    expect(releaseCandidate).toContain("if-no-files-found: error");
    expect(releaseCandidate).not.toContain("pnpm run audit");
    expect(releaseCandidate).not.toContain("pnpm run build");
  });

  it("keeps former duplicate lanes as manual diagnostics only", async () => {
    const [playwright, releaseChecks, mockup] = await Promise.all([
      readRepoFile(WORKFLOWS.playwright),
      readRepoFile(WORKFLOWS.releaseChecks),
      readRepoFile(WORKFLOWS.mockupSprintOrchestration),
    ]);

    expect(playwright).toContain("name: Playwright Diagnostics");
    expectManualOnly(playwright, "Playwright diagnostics");
    expect(playwright).not.toContain("Playwright E2E Tests (ubuntu-latest)");
    expect(playwright).not.toContain("Verify packed npm package");

    expect(releaseChecks).toContain("name: Release Candidate Diagnostics");
    expectManualOnly(releaseChecks, "Release candidate diagnostics");
    expect(releaseChecks).toContain("node scripts/verify-release-install.mjs");
    expect(releaseChecks).toContain("pnpm run ${{ matrix.electron-script }} -- --publish never");

    expect(mockup).toContain("name: Mockup Sprint Diagnostics");
    expectManualOnly(mockup, "Mockup sprint diagnostics");
    expect(mockup).toContain("pnpm run test:orchestration:ci-dag:run");
    expect(mockup).toContain("pnpm run test:orchestration:ci-dag:electron:run");
  });

  it("keeps published release publishing and desktop artifacts in one workflow", async () => {
    const [release, desktopRelease] = await Promise.all([
      readRepoFile(WORKFLOWS.release),
      readRepoFile(WORKFLOWS.desktopRelease),
    ]);
    const preflight = getJobBlock(release, "release-preflight");
    const publish = getJobBlock(release, "publish-npm");
    const desktop = getJobBlock(release, "desktop-packages");

    expect(release).toContain("name: Release");
    expect(release).toMatch(/release:\n    types: \[published\]/);
    expect(preflight).toContain("pnpm run audit");
    expect(preflight).toContain("Verify release tag is on main");
    expect(publish).toContain("needs: release-preflight");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("npm install -g npm@11.5.1");
    expect(publish).toContain("npm provenance dependency OK");
    expect(publish).toContain("npm publish");
    expect(publish).not.toContain("pnpm run test:backend:coverage");
    expect(publish).not.toContain("pnpm run test:dashboard");
    expect(desktop).toContain("needs: release-preflight");
    expect(desktop).toContain("contents: write");
    expect(desktop).toContain("max-parallel: 3");
    expect(desktop).toContain("softprops/action-gh-release@v2");
    expect(desktop).toContain("node node_modules/electron/install.js");
    expect(desktop).toContain("pnpm run build && pnpm run electron:prepare-deps && pnpm exec electron-builder");
    expect(desktop).toContain("--publish never");
    expectCommandBefore(release, "run: pnpm install --frozen-lockfile --ignore-scripts", "run: pnpm run audit");

    expect(desktopRelease).toContain("name: Desktop Release Diagnostics");
    expectManualOnly(desktopRelease, "Desktop release diagnostics");
    expect(desktopRelease).toContain("permissions:\n  contents: read");
    expect(desktopRelease).toContain('GH_TOKEN: ""');
    expect(desktopRelease).not.toContain("softprops/action-gh-release");
  });

  it("keeps Playwright config isolated, serialized, and failure-artifact friendly", async () => {
    const config = await readRepoFile(PLAYWRIGHT_CONFIG);

    expect(config).toContain("command: 'node dist/index.js'");
    expect(config).toContain("process.env.CODEUX_E2E_DASHBOARD_PORT || process.env.DASHBOARD_PORT || '4464'");
    expect(config).toContain("baseURL: dashboardBaseUrl");
    expect(config).toContain("url: `${dashboardBaseUrl}/health`");
    expect(config).toContain("CODE_UX_DIRECTORY_BROWSER_ROOTS: os.tmpdir()");
    expect(config).toContain("CODEUX_E2E_PROVIDER_CLI_SHIM: mockProviderCliPath");
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
  });

  it("keeps mockup DAG regression coverage strict", async () => {
    const [packageJson, runnerScript, scenarioScript] = await Promise.all([
      readRepoFile("package.json").then((content) => JSON.parse(content) as PackageJson),
      readRepoFile("scripts/e2e/run-mockup-sprint-pentest.mjs"),
      readRepoFile("scripts/e2e/mockup-sprint-pentest-scenarios.mjs"),
    ]);

    const ciDagRunScript = packageJson.scripts?.["test:orchestration:ci-dag:run"] ?? "";
    const electronDagRunScript = packageJson.scripts?.["test:orchestration:ci-dag:electron:run"] ?? "";

    expect(ciDagRunScript).toContain("--execution-mode docker");
    expect(ciDagRunScript).toContain("--scenario ci-small-dag");
    expect(ciDagRunScript).toContain("--stall-timeout-ms 180000");
    expect(electronDagRunScript).toContain("--runtime electron");
    expect(electronDagRunScript).toContain("--execution-mode fixture");
    expect(electronDagRunScript).toContain("--scenario ci-small-dag-electron");
    expect(electronDagRunScript).toContain("--stall-timeout-ms 180000");

    expect(runnerScript).toContain("const DEFAULT_STALL_TIMEOUT_MS = 3 * 60 * 1000");
    expect(runnerScript).toContain("mockup_pentest_progress");
    expect(runnerScript).toContain("mockup_pentest_stalled");
    expect(runnerScript).toContain("mockup_pentest_dependency_merge_violation");
    expect(runnerScript).toContain("findMockupDagDependencyMergeViolations(expectedProjectRun, latestTasks)");
    expect(runnerScript).toContain("DAG dependency merge invariant failed");
    expect(runnerScript).toContain("writeRuntimeLogToConsole");

    const ciDagValidationTask = scenarioScript.slice(
      scenarioScript.indexOf('key: "ci-dag-validation"'),
      scenarioScript.indexOf("return tasks;", scenarioScript.indexOf('key: "ci-dag-validation"')),
    );
    expect(ciDagValidationTask).toContain('dependsOn: ["ci-dag-batch-01", "ci-dag-batch-02"]');
    expect(ciDagValidationTask).toContain('"test/run-validation.mjs"');
    expect(scenarioScript).toContain('commands: [{ command: "node test/run-validation.mjs", exitCode: 0 }]');
  });

  it("keeps the release install verifier pinned to the locally installed CLI bin and artifact reuse explicit", async () => {
    const verifier = await readRepoFile(RELEASE_INSTALL_VERIFIER);

    expect(verifier).toContain('path.join(installDir, "node_modules", ".bin", binName)');
    expect(verifier).toContain('installedPackagePath("package.json")');
    expect(verifier).toContain("process.execPath");
    expect(verifier).toContain('process.env.CODE_UX_SKIP_RELEASE_INSTALL_BUILD === "1"');
    expect(verifier).toContain("requireExistingBuildArtifacts");
    expect(verifier).toContain("Build artifacts are present; skipping pnpm run build.");
    expect(verifier).not.toContain('"exec"');
    expect(verifier).not.toContain("'exec'");
  });
});
