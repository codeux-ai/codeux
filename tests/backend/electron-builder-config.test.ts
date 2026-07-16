import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("electron-builder packaged defaults", () => {
  it("packages the automatic model-pricing catalogue used by desktop stats", () => {
    const config = require("../../electron-builder.config.cjs") as {
      files?: string[];
    };
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      files?: string[];
    };
    const catalogPath = path.join(process.cwd(), "assets", "models-dev", "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
      openai?: { models?: Record<string, { cost?: { input?: number; output?: number } }> };
    };

    expect(packageJson.files).toEqual(expect.arrayContaining(["assets"]));
    expect(config.files).toEqual(expect.arrayContaining(["assets/models-dev/catalog.json"]));
    expect(catalog.openai?.models?.["gpt-5.5"]?.cost).toEqual(expect.objectContaining({
      input: 5,
      output: 30,
    }));
  });

  it("packages runtime docs-web assets for installed and desktop docs routes", () => {
    const config = require("../../electron-builder.config.cjs") as {
      files?: string[];
    };
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      files?: string[];
    };

    expect(packageJson.files).toEqual(expect.arrayContaining(["docs-web"]));
    expect(config.files).toEqual(expect.arrayContaining(["docs-web/**"]));
    expect(fs.existsSync(path.join(process.cwd(), "docs-web", "index.md"))).toBe(true);
  });

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

  it("builds a copy-safe Electron runtime with its MCP peer dependency", () => {
    const config = require("../../electron-builder.config.cjs") as {
      linux?: { executableName?: string };
    };
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const preparer = fs.readFileSync(
      path.join(process.cwd(), "scripts", "prepare-electron-runtime-deps.mjs"),
      "utf8",
    );

    expect(packageJson.dependencies).toHaveProperty("zod");
    expect(packageJson.scripts?.["electron:smoke-installed"]).toBe(
      "node scripts/smoke-installed-electron.mjs",
    );
    expect(preparer).toContain('"--config.node-linker=hoisted"');
    expect(preparer).toContain("validateRuntimeTree();");
    expect(preparer).toContain("@modelcontextprotocol/sdk/server/index.js");
    expect(preparer).toContain('"zod"');
    expect(config.linux?.executableName).toBe("codeux");
  });

  it("installs and launches every native package format for release smoke", () => {
    const installerSmoke = fs.readFileSync(
      path.join(process.cwd(), "scripts", "smoke-installed-electron.mjs"),
      "utf8",
    );
    const mainProcessSource = fs.readFileSync(path.join(process.cwd(), "src/electron/main.ts"), "utf8");

    expect(installerSmoke).toContain('findArtifact(".deb")');
    expect(installerSmoke).toContain('["/S", `/D=${installDirectory}`]');
    expect(installerSmoke).toContain("windowsVerbatimArguments: true");
    expect(installerSmoke).toContain('findArtifact(".dmg")');
    expect(installerSmoke).toContain('run("hdiutil", ["attach"');
    expect(installerSmoke).toContain('input: "Y\\n"');
    expect(installerSmoke).toContain('stdio: ["pipe", "inherit", "inherit"]');
    expect(installerSmoke).toContain('const versionMarker = `-${packageJson.version}-`');
    expect(installerSmoke).toContain("entry.name.includes(versionMarker)");
    expect(installerSmoke).toContain("CODE_UX_ELECTRON_STARTUP_SMOKE_FILE");
    expect(installerSmoke).toContain("marker.packaged !== true");
    expect(mainProcessSource).toContain('window.webContents.once("did-finish-load"');
    expect(mainProcessSource).toContain("writeElectronStartupSmoke");
    expect(mainProcessSource).toContain('CODE_UX_ELECTRON_STARTUP_SMOKE_EXIT === "1"');
    expect(mainProcessSource).toContain("exitElectronStartupSmoke()");
    expect(mainProcessSource).toContain('app.on("before-quit"');
    expect(mainProcessSource).toContain('app.exit(typeof process.exitCode === "number" ? process.exitCode : 0)');
  });
});
