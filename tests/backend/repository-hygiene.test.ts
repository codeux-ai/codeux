import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOTS = ["src", "dashboard/src"] as const;
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const PLAYWRIGHT_WORKFLOW_PATH = ".github/workflows/playwright.yml";
const PACKAGE_JSON_PATH = "package.json";

async function collectOrigFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const matches = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      return collectOrigFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".orig") ? [entryPath] : [];
  }));

  return matches.flat();
}

describe("repository hygiene", () => {
  it("keeps editor and merge backup artifacts out of source trees", async () => {
    const origFiles = (await Promise.all(SOURCE_ROOTS.map(collectOrigFiles)))
      .flat()
      .map((filePath) => relative(process.cwd(), filePath))
      .sort();

    expect(origFiles).toEqual([]);
  });

  it("keeps CI workflows pinned, cancellable, and security-audited", async () => {
    const [ciWorkflow, playwrightWorkflow, packageJsonText] = await Promise.all([
      readFile(CI_WORKFLOW_PATH, "utf8"),
      readFile(PLAYWRIGHT_WORKFLOW_PATH, "utf8"),
      readFile(PACKAGE_JSON_PATH, "utf8"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as {
      packageManager?: string;
      engines?: { node?: string };
      scripts?: Record<string, string>;
    };

    expect(packageJson.packageManager).toBe("pnpm@10.33.0");
    expect(packageJson.engines?.node).toBe(">=22");

    for (const workflow of [ciWorkflow, playwrightWorkflow]) {
      expect(workflow).toContain("version: 10.33.0");
      expect(workflow).toContain("node-version: 22");
      expect(workflow).toContain("pnpm install --frozen-lockfile");
      expect(workflow).toContain("concurrency:");
      expect(workflow).toContain("cancel-in-progress: true");
    }

    expect(ciWorkflow).toContain("pnpm run audit");
    expect(packageJson.scripts?.audit).toBe("pnpm audit --audit-level=high");
  });

  it("keeps Playwright E2E isolated and aligned with the dev integration flow", async () => {
    const [ciWorkflow, playwrightWorkflow] = await Promise.all([
      readFile(CI_WORKFLOW_PATH, "utf8"),
      readFile(PLAYWRIGHT_WORKFLOW_PATH, "utf8"),
    ]);

    expect(playwrightWorkflow).toMatch(/push:\s*\n\s*branches:\s*\[[^\]]*\bdev\b[^\]]*\]/);
    expect(playwrightWorkflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[[^\]]*\bdev\b[^\]]*\]/);
    expect(playwrightWorkflow).not.toMatch(/\b(master|release)\b/);
    expect(playwrightWorkflow).not.toContain("workflow_call:");
    expect(playwrightWorkflow).not.toContain("workflow_run:");
    expect(playwrightWorkflow).not.toContain("workflow_dispatch:");

    const buildIndex = playwrightWorkflow.indexOf("pnpm run build");
    const installChromiumIndex = playwrightWorkflow.indexOf("pnpm exec playwright install chromium --with-deps");
    const runTestsIndex = playwrightWorkflow.indexOf("pnpm exec playwright test");
    const uploadResultsIndex = playwrightWorkflow.indexOf("path: test-results/");

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(installChromiumIndex).toBeGreaterThanOrEqual(0);
    expect(runTestsIndex).toBeGreaterThan(buildIndex);
    expect(runTestsIndex).toBeGreaterThan(installChromiumIndex);
    expect(playwrightWorkflow).toContain("pnpm exec playwright install-deps chromium");
    expect(playwrightWorkflow).toContain("if: failure()");
    expect(uploadResultsIndex).toBeGreaterThan(runTestsIndex);
    expect(ciWorkflow).not.toContain("pnpm exec playwright test");
  });

  it("keeps the local CI script ordered and complete", async () => {
    const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      audit: "pnpm audit --audit-level=high",
      lint: "tsc --noEmit --incremental --tsBuildInfoFile .cache/tsc/root.tsbuildinfo",
      "test:backend:coverage": "vitest run tests/backend --coverage",
      "test:dashboard": "vitest run tests/dashboard",
      build: "node scripts/build.mjs",
    });
    expect(packageJson.scripts?.ci).toBe(
      "pnpm run audit && pnpm run lint && pnpm run test:backend:coverage && pnpm run test:dashboard && pnpm run build",
    );
  });
});
