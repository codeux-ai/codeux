import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("electron-builder packaged defaults", () => {
  it("packages the default agent assets required by runtime seeding", () => {
    const config = require("../../electron-builder.config.cjs") as {
      extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
    };
    const defaultsResource = config.extraResources?.find((resource) => resource.to === ".code-ux-defaults");

    expect(defaultsResource).toBeDefined();
    expect(defaultsResource?.filter).toEqual(expect.arrayContaining([
      "agents/planning_agent.md",
      "agents/project_manager.md",
      "agents/quality_assurance_agent.md",
      "agents/worker.md",
      "container/setup.sh",
    ]));
    expect(defaultsResource?.filter).not.toContain("agents/iris.md");

    for (const assetPath of defaultsResource?.filter ?? []) {
      expect(fs.existsSync(path.join(process.cwd(), ".code-ux", assetPath))).toBe(true);
    }
  });
});
