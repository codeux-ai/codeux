import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ensureDefaultCodeUxAssetsInstalled } from "../../../src/services/code-ux-default-assets-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Code UX default assets service", () => {
  it("installs missing base agents and container setup into the user directory without overwriting existing files", async () => {
    vi.stubEnv("CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS", "1");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-default-assets-"));
    tempDirs.push(dir);
    const projectRoot = path.join(dir, "app");
    const homeDir = path.join(dir, "home");
    vi.stubEnv("HOME", homeDir);

    await fs.mkdir(path.join(projectRoot, ".code-ux", "agents"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, ".code-ux", "container"), { recursive: true });

    for (const fileName of ["planning_agent.md", "project_manager.md", "quality_assurance_agent.md", "worker.md"]) {
      await fs.writeFile(
        path.join(projectRoot, ".code-ux", "agents", fileName),
        `default ${fileName}\n`,
        "utf8",
      );
    }
    await fs.writeFile(path.join(projectRoot, ".code-ux", "container", "setup.sh"), "#!/usr/bin/env bash\necho setup\n", "utf8");

    await fs.mkdir(path.join(homeDir, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".code-ux", "agents", "worker.md"), "custom worker\n", "utf8");

    const result = await ensureDefaultCodeUxAssetsInstalled({ projectRoot });

    expect(result.sourceDir).toBe(path.join(projectRoot, ".code-ux"));
    expect(result.installed.map((asset) => path.relative(path.join(homeDir, ".code-ux"), asset.targetPath)).sort()).toEqual([
      "agents/planning_agent.md",
      "agents/project_manager.md",
      "agents/quality_assurance_agent.md",
      "container/setup.sh",
    ]);
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "agents", "worker.md"), "utf8")).resolves.toBe("custom worker\n");
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "agents", "planning_agent.md"), "utf8")).resolves.toBe("default planning_agent.md\n");
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "container", "setup.sh"), "utf8")).resolves.toContain("echo setup");
  });
});
