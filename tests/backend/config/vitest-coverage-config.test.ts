import { describe, expect, it } from "vitest";
import vitestConfig from "../../../vitest.config.js";

type CoverageThresholds = Record<string, number | Record<string, number>>;

type CoverageConfig = {
  thresholds?: CoverageThresholds;
  include?: string[];
  exclude?: string[];
};

type TestConfig = {
  test?: {
    coverage?: CoverageConfig;
  };
};

const minimumGlobalThresholds = {
  lines: 77.4,
  functions: 71.5,
  branches: 66.1,
  statements: 76.0,
} as const;

const requiredGeneratedAndRuntimeExclusions = [
  "src/index.ts",
  "src/worker/index.ts",
  "src/server/index.ts",
  "src/sprint/index.ts",
  "src/app-db-schema.ts",
  "src/repositories/db/sqlite-database-adapter.ts",
] as const;

function getCoverageConfig(): Required<Pick<CoverageConfig, "thresholds" | "include" | "exclude">> {
  const coverage = (vitestConfig as TestConfig).test?.coverage;

  expect(coverage).toBeDefined();
  expect(coverage?.thresholds).toBeDefined();
  expect(coverage?.include).toEqual(expect.any(Array));
  expect(coverage?.exclude).toEqual(expect.any(Array));

  return {
    thresholds: coverage?.thresholds ?? {},
    include: coverage?.include ?? [],
    exclude: coverage?.exclude ?? [],
  };
}

function expectNumericThreshold(value: CoverageThresholds[string], metric: string): number {
  expect(typeof value).toBe("number");

  if (typeof value !== "number") {
    throw new Error(`Expected ${metric} threshold to be numeric.`);
  }

  return value;
}

function expectFileThreshold(value: CoverageThresholds[string], filename: string): Record<string, number> {
  expect(value).toEqual(expect.any(Object));
  expect(Array.isArray(value)).toBe(false);

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${filename} threshold to be an object.`);
  }

  return value;
}

describe("vitest coverage configuration", () => {
  it("keeps backend coverage thresholds from drifting downward", () => {
    const { thresholds } = getCoverageConfig();

    for (const [metric, minimum] of Object.entries(minimumGlobalThresholds)) {
      const configured = expectNumericThreshold(thresholds[metric], metric);

      expect(configured).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("keeps backend source coverage scoped and excludes generated runtime entrypoints explicitly", () => {
    const { include, exclude } = getCoverageConfig();

    expect(include).toContain("src/**/*.ts");
    expect(include.some((pattern) => pattern.startsWith("dashboard/"))).toBe(false);
    expect(include.some((pattern) => pattern.includes("dashboard/src"))).toBe(false);

    for (const exclusion of requiredGeneratedAndRuntimeExclusions) {
      expect(exclude).toContain(exclusion);
    }
  });

  it("keeps the activity cache service line coverage gate enforceable", () => {
    const { thresholds } = getCoverageConfig();
    const activityCacheThreshold = expectFileThreshold(
      thresholds["src/server/activity-cache-service.ts"],
      "src/server/activity-cache-service.ts",
    );

    expect(activityCacheThreshold).toMatchObject({ lines: expect.any(Number) });
    expect(activityCacheThreshold.lines).toBeGreaterThanOrEqual(80);
  });
});
