import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = {
  ci: ".github/workflows/ci.yml",
  playwright: ".github/workflows/playwright.yml",
  releaseChecks: ".github/workflows/release-checks.yml",
} as const;

const REQUIRED_INSTALL = "pnpm install --frozen-lockfile --ignore-scripts";
const PACKAGE_MANAGER_VERSION = "10.33.0";
const NODE_VERSION = "22";

type PackageJson = {
  packageManager?: string;
  engines?: {
    node?: string;
  };
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

function expectCommandBefore(workflow: string, before: string, after: string): void {
  const beforeIndex = workflow.indexOf(before);
  const afterIndex = workflow.indexOf(after);

  expect(beforeIndex, `Expected to find "${before}"`).toBeGreaterThanOrEqual(0);
  expect(afterIndex, `Expected to find "${after}"`).toBeGreaterThanOrEqual(0);
  expect(beforeIndex, `"${before}" should appear before "${after}"`).toBeLessThan(afterIndex);
}

describe("GitHub workflow health", () => {
  it("keeps package toolchain policy pinned to pnpm 10.33.0 and Node 22", async () => {
    const packageJson = JSON.parse(await readRepoFile("package.json")) as PackageJson;

    expect(packageJson.packageManager).toBe(`pnpm@${PACKAGE_MANAGER_VERSION}`);
    expect(packageJson.engines?.node).toBe(`>=${NODE_VERSION}`);
  });

  it("keeps core CI split into auditable jobs with independent security audit", async () => {
    const ci = await readRepoFile(WORKFLOWS.ci);

    expectWorkflowToolchain(ci, "CI");
    expectConcurrencyCancellation(ci, "CI");

    for (const jobName of ["typecheck", "test-backend", "test-dashboard", "build", "security-audit"]) {
      expect(getJobBlock(ci, jobName)).toContain("runs-on: ubuntu-latest");
    }

    expectJobRunsCommandIndependently(ci, "security-audit", "pnpm run audit");
    expect(getJobBlock(ci, "typecheck")).toContain("pnpm run quality:guardrails");
    expect(getJobBlock(ci, "typecheck")).toContain("pnpm run typecheck");
    expect(getJobBlock(ci, "test-backend")).toContain("pnpm run test:backend:coverage");
    expect(getJobBlock(ci, "test-dashboard")).toContain("pnpm run test:dashboard");
    expect(getJobBlock(ci, "build")).toContain("pnpm run build");
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

    expectWorkflowToolchain(playwright, "Playwright");
    expectConcurrencyCancellation(playwright, "Playwright");
    expect(playwright).toMatch(/push:\n    branches: \[main\]/);
    expect(playwright).toMatch(/pull_request:\n    branches: \[main\]/);
    expect(playwright).not.toContain("branches: [dev]");

    expectCommandBefore(playwright, "run: pnpm run build", "run: pnpm run test:e2e");
    expectCommandBefore(playwright, "id: playwright-cache", "run: pnpm exec playwright install chromium");
    expect(playwright).toContain("run: pnpm exec playwright install-deps chromium");
    expect(playwright).toContain("run: pnpm exec playwright install chromium");
    expect(playwright).toMatch(/if: always\(\)\n        uses: actions\/upload-artifact@v4/);
    expect(playwright).toContain("test-results/");
    expect(playwright).toContain("playwright-report/");

    expectCacheKey(playwright, "-nm-", ["package.json", "pnpm-lock.yaml"]);
    expectCacheKey(playwright, "-vite-e2e-", ["package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json", "dashboard/tsconfig.json"]);
    expectCacheKey(playwright, "-playwright-", ["package.json", "pnpm-lock.yaml"]);
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
    expect(releaseChecks).toContain("pnpm run electron:install-deps");
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
