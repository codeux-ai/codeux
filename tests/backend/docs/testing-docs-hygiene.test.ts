import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const TESTING_GUIDE_PATH = "docs/development/testing-and-quality.md";

const REQUIRED_COMMANDS = [
  "pnpm run lint",
  "pnpm run test:backend",
  "pnpm run test:dashboard",
  "pnpm run test:backend:coverage",
  "pnpm exec playwright test",
  "pnpm run build",
  "pnpm run ci",
] as const;

describe("testing documentation hygiene", () => {
  it("documents the required quality commands", async () => {
    const guide = await readFile(TESTING_GUIDE_PATH, "utf8");

    for (const command of REQUIRED_COMMANDS) {
      expect(guide, `Missing documented command: ${command}`).toContain(command);
    }
  });

  it("keeps the testing guide aligned with pnpm-only workflows", async () => {
    const guide = await readFile(TESTING_GUIDE_PATH, "utf8");

    expect(guide).not.toMatch(/\b(?:npm|yarn|npx)\s+(?:run|test|start|install|exec|ci)\b/i);
  });

  it("documents the active backend coverage gates", async () => {
    const guide = await readFile(TESTING_GUIDE_PATH, "utf8");

    expect(guide).toContain("77.4% lines");
    expect(guide).toContain("71.5% functions");
    expect(guide).toContain("66.1% branches");
    expect(guide).toContain("76.0% statements");
    expect(guide).toContain("src/server/activity-cache-service.ts");
    expect(guide).toContain("80% line threshold");
  });
});
