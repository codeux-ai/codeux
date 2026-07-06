import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import vitestConfig from "../../../vitest.config";

type PackageJson = {
  scripts?: Record<string, string>;
};

type CoverageThresholds = Record<string, unknown> & {
  lines?: number;
  functions?: number;
  branches?: number;
  statements?: number;
};

type VitestPolicyConfig = {
  test?: {
    coverage?: {
      include?: unknown;
      thresholds?: CoverageThresholds;
    };
  };
};

const CONFIG_PATH = "vitest.config.ts";
const PACKAGE_PATH = "package.json";
const ACTIVITY_CACHE_SERVICE_PATH = "src/server/activity-cache-service.ts";
const REQUIRED_ENV = {
  VITEST_IN_MEMORY_DB: "true",
  TZ: "UTC",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
} as const;
const MINIMUM_GLOBAL_THRESHOLDS = {
  lines: 77.4,
  functions: 71.5,
  branches: 66.1,
  statements: 76.0,
} as const;

async function readRepoFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  expect(value, `${label} should be an object`).toBeTypeOf("object");
  expect(value, `${label} should not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} should not be an array`).toBe(false);
  return value as Record<string, unknown>;
}

function expectNumber(value: unknown, label: string): number {
  expect(value, `${label} should be a number`).toBeTypeOf("number");
  return value as number;
}

function getResolvedConfig(): VitestPolicyConfig {
  expect(vitestConfig, "vitest config should be an object export").toBeTypeOf("object");
  expect(vitestConfig, "vitest config should not be null").not.toBeNull();
  expect(Array.isArray(vitestConfig), "vitest config should not be an array export").toBe(false);
  return vitestConfig as VitestPolicyConfig;
}

function expectEnvAssignmentBeforeExport(source: string, key: keyof typeof REQUIRED_ENV): void {
  const exportIndex = source.indexOf("export default");
  expect(exportIndex, "vitest config should have a default export").toBeGreaterThanOrEqual(0);

  const assignment = new RegExp(`process\\.env\\.${key}\\s*=\\s*["']${REQUIRED_ENV[key]}["']\\s*;`);
  const match = assignment.exec(source);

  expect(match, `process.env.${key} should be set to ${REQUIRED_ENV[key]}`).not.toBeNull();
  expect(match?.index ?? -1, `process.env.${key} should be set before the config export`).toBeLessThan(exportIndex);
}

describe("Vitest coverage policy", () => {
  it("sets deterministic test environment defaults before exporting config", async () => {
    const source = await readRepoFile(CONFIG_PATH);

    for (const key of Object.keys(REQUIRED_ENV) as Array<keyof typeof REQUIRED_ENV>) {
      expectEnvAssignmentBeforeExport(source, key);
    }
  });

  it("keeps backend coverage scoped to source TypeScript with locked threshold floors", () => {
    const coverage = getResolvedConfig().test?.coverage;
    const include = coverage?.include;

    expect(include, "coverage.include should be an array").toEqual(expect.any(Array));
    expect(include).toContain("src/**/*.ts");
    expect(include).not.toContain("dashboard/**/*.ts");
    expect(include).not.toContain("dashboard/**/*.tsx");
    expect((include as string[]).some((entry) => entry.startsWith("dashboard/"))).toBe(false);

    const thresholds = expectObject(coverage?.thresholds, "coverage.thresholds");
    for (const [name, minimum] of Object.entries(MINIMUM_GLOBAL_THRESHOLDS)) {
      expect(expectNumber(thresholds[name], `coverage.thresholds.${name}`)).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("keeps the activity cache service file-specific line threshold enforced", () => {
    const thresholds = expectObject(getResolvedConfig().test?.coverage?.thresholds, "coverage.thresholds");
    const activityCacheThreshold = expectObject(
      thresholds[ACTIVITY_CACHE_SERVICE_PATH],
      `coverage.thresholds["${ACTIVITY_CACHE_SERVICE_PATH}"]`,
    );

    expect(expectNumber(activityCacheThreshold.lines, "activity cache service line threshold")).toBeGreaterThanOrEqual(80);
  });

  it("keeps package scripts wired to coverage-enforcing backend validation", async () => {
    const packageJson = JSON.parse(await readRepoFile(PACKAGE_PATH)) as PackageJson;
    const scripts = packageJson.scripts ?? {};

    expect(scripts["test:backend:coverage"]).toBe("vitest run tests/backend --coverage");
    expect(scripts["test:coverage"]).toBe("vitest run --coverage");
    expect(scripts.ci, "ci should run backend coverage").toContain("pnpm run test:backend:coverage");
    expect(scripts.ci, "ci should not replace backend coverage with non-coverage backend tests").not.toMatch(
      /\bpnpm run test:backend(?!:coverage)\b/,
    );
  });
});
