import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  buildGeneratedSprintPreviewScript,
  detectPackageManager,
  detectSprintPreviewCommands,
  normalizePreviewPath,
  resolveStaticPreviewEntry,
} from "../../../src/services/sprint-preview-utils.js";

const tempDirs: string[] = [];

const createTempRepo = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-preview-utils-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("sprint-preview-utils", () => {
  it("normalizes browser paths and strips host prefixes", () => {
    expect(normalizePreviewPath("dashboard")).toBe("/dashboard");
    expect(normalizePreviewPath("https://example.com/foo?bar=1#hash")).toBe("/foo?bar=1#hash");
    expect(normalizePreviewPath("")).toBe("/");
  });

  it("detects package manager from lockfiles", async () => {
    const repoDir = await createTempRepo();
    await fs.writeFile(path.join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    await expect(detectPackageManager(repoDir)).resolves.toBe("pnpm");
  });

  it("uses prefer-offline no-frozen-lockfile for pnpm preview installs", async () => {
    const repoDir = await createTempRepo();
    await fs.writeFile(path.join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({
      scripts: {
        preview: "vite preview",
      },
    }), "utf8");

    const detection = await detectSprintPreviewCommands(repoDir);

    expect(detection.installCommand).toContain("pnpm install --prefer-offline --no-frozen-lockfile");
    expect(detection.installCommand).not.toContain("--frozen-lockfile");
  });

  it("prefers a preview script and matching package-manager commands", async () => {
    const repoDir = await createTempRepo();
    await fs.writeFile(path.join(repoDir, "yarn.lock"), "", "utf8");
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({
      scripts: {
        build: "vite build",
        preview: "vite preview",
      },
    }), "utf8");

    const detection = await detectSprintPreviewCommands(repoDir);

    expect(detection.packageManager).toBe("yarn");
    expect(detection.installCommand).toContain("yarn install");
    expect(detection.buildCommand).toBe("yarn build");
    expect(detection.runCommand).toContain("yarn preview --host 0.0.0.0 --port \"$SPRINT_PREVIEW_PORT\"");
    expect(detection.runCommand).toContain("DASHBOARD_PORT=\"$SPRINT_PREVIEW_PORT\"");
  });

  it("parses UTF-8 BOM package.json files and prefers preview over dev", async () => {
    const repoDir = await createTempRepo();
    await fs.writeFile(path.join(repoDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(path.join(repoDir, "package.json"), `\uFEFF${JSON.stringify({
      scripts: {
        build: "vite build",
        dev: "vite dev",
        preview: "vite preview",
      },
    })}`, "utf8");

    const detection = await detectSprintPreviewCommands(repoDir);

    expect(detection.packageManager).toBe("pnpm");
    expect(detection.buildCommand).toBe("pnpm build");
    expect(detection.runCommand).toContain("pnpm preview -- --host 0.0.0.0 --port \"$SPRINT_PREVIEW_PORT\"");
    expect(detection.runCommand).not.toContain("pnpm dev");
  });

  it("does not use a dev script as an automatic preview fallback", async () => {
    const repoDir = await createTempRepo();
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({
      scripts: {
        dev: "vite dev",
      },
    }), "utf8");

    const detection = await detectSprintPreviewCommands(repoDir);

    expect(detection.runCommand).toBeNull();
  });

  it("falls back to serving built static output when no runtime script exists", async () => {
    const repoDir = await createTempRepo();
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({
      scripts: {
        build: "vite build",
      },
    }), "utf8");
    await fs.mkdir(path.join(repoDir, "dist"), { recursive: true });

    const detection = await detectSprintPreviewCommands(repoDir);

    expect(detection.buildCommand).toBe("npm run build");
    expect(detection.runCommand).toContain("serve -s \"$candidate\" -l \"$SPRINT_PREVIEW_PORT\"");
    await expect(resolveStaticPreviewEntry(repoDir)).resolves.toBe("dist");
  });

  it("generates a startup script that installs, builds, and runs with static fallback", () => {
    const script = buildGeneratedSprintPreviewScript();

    expect(script).toContain("SPRINT_PREVIEW_WORKSPACE");
    expect(script).toContain("SPRINT_PREVIEW_WORKTREE");
    expect(script).toContain("SPRINT_PREVIEW_PROXY_PORT");
    expect(script).toContain("SPRINT_PREVIEW_INSTALL_COMMAND");
    expect(script).toContain("SPRINT_PREVIEW_BUILD_COMMAND");
    expect(script).toContain("SPRINT_PREVIEW_RUN_COMMAND");
    expect(script).toContain("DASHBOARD_HOST");
    expect(script).toContain("DASHBOARD_PORT");
    expect(script).toContain("start_preview_port_proxy");
    expect(script).toContain("const resolveUpstreamPort = () => {");
    expect(script).toContain("start_preview_port_proxy \"$SPRINT_PREVIEW_PROXY_PORT\" \"$SPRINT_PREVIEW_PORT\"");
    expect(script).toContain("bash -c \"$SPRINT_PREVIEW_INSTALL_COMMAND\"");
    expect(script).not.toContain("bash -lc \"$SPRINT_PREVIEW_INSTALL_COMMAND\"");
    expect(script).toContain("serve -s \"$candidate\" -l \"$SPRINT_PREVIEW_PORT\"");
  });
});
