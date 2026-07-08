import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("electron-builder packaged defaults", () => {
  it("keeps renderer privileges constrained in the desktop BrowserWindow", () => {
    const mainProcessSource = fs.readFileSync(path.join(process.cwd(), "src/electron/main.ts"), "utf8");

    expect(mainProcessSource).toContain("contextIsolation: true");
    expect(mainProcessSource).toContain("nodeIntegration: false");
    expect(mainProcessSource).toContain("sandbox: true");
    expect(mainProcessSource).toContain("setPermissionRequestHandler");
    expect(mainProcessSource).toContain("setWindowOpenHandler");
    expect(mainProcessSource).toContain("will-navigate");
  });

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
      "quicksprints/templates/*.md",
    ]));
    expect(defaultsResource?.filter).not.toContain("agents/iris.md");

    for (const assetPath of defaultsResource?.filter ?? []) {
      if (assetPath.includes("*")) {
        const wildcardIndex = assetPath.indexOf("*");
        const directory = assetPath.slice(0, wildcardIndex);
        const suffix = assetPath.slice(wildcardIndex + 1);
        const absoluteDirectory = path.join(process.cwd(), ".code-ux", directory);
        expect(fs.readdirSync(absoluteDirectory).some((entry) => entry.endsWith(suffix))).toBe(true);
        continue;
      }
      expect(fs.existsSync(path.join(process.cwd(), ".code-ux", assetPath))).toBe(true);
    }
  });

  it("keeps the ONNX speech runtime loadable outside ASAR", () => {
    const config = require("../../electron-builder.config.cjs") as {
      asarUnpack?: string[];
      extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
    };

    expect(config.asarUnpack).toEqual(expect.arrayContaining([
      "node_modules/**/*.node",
      "node_modules/onnxruntime-node/**",
    ]));
    expect(config.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: ".cache/electron-runtime/node_modules",
        to: "node_modules",
      }),
    ]));
  });
});
