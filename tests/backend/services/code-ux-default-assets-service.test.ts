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
  it("keeps the bundled Planning agent integration-aware and free of fixed task-count pressure", async () => {
    const instructions = await fs.readFile(
      path.join(process.cwd(), ".code-ux", "agents", "planning_agent.md"),
      "utf8",
    );

    for (const requiredSection of [
      "## Coverage And Risk Inventory",
      "## Decomposition Protocol",
      "## Granularity Rules",
    ]) {
      expect(instructions).toContain(requiredSection);
    }

    for (const requiredGuidance of [
      "every runtime consumer",
      "startup, shutdown, restart, reconnect, recovery, stale state, and cleanup",
      "executable integration/E2E coverage",
      "A large or security-sensitive sprint may legitimately require more than eight tasks",
      "a skeptical sprint-completion reviewer",
    ]) {
      expect(instructions).toContain(requiredGuidance);
    }

    expect(instructions).not.toContain("Prefer 3 to 8 tasks");
  });

  it("keeps the bundled Project Manager operating manual comprehensive", async () => {
    const instructions = await fs.readFile(
      path.join(process.cwd(), ".code-ux", "agents", "project_manager.md"),
      "utf8",
    );

    for (const requiredSection of [
      "## MCP Capability Map",
      "## Programming Work And Sprint Delegation",
      "## Concise Manual Sprint-Planning Guide",
      "## Scheduler Self-Wakeup Protocol",
      "## Long-Term Memory Responsibility",
      "## Persistent Skills And Volumes",
      "## Custom Dashboard Workflow",
      "## Node Flow Workflow",
      "## Rich Response Design",
    ]) {
      expect(instructions).toContain(requiredSection);
    }

    for (const requiredCapability of [
      "manage_sprints",
      "scheduler_code_ux",
      "manage_custom_dashboards",
      "manage_node_flows",
      "manage_skills",
      "search_skills",
      "add_long_term_memory",
      "short-term memory",
      "long-term memory",
      "codeux:memory",
      "codeux:actions",
    ]) {
      expect(instructions).toContain(requiredCapability);
    }

    for (const requiredPlanningGuidance of [
      "planningGuidance.estimatedCompletionAt",
      "planningGuidance.nextCheckAt",
      "planningGuidance.recheckIntervalMs",
      "planningGuidance.status",
      "planningGuidance.isTerminal",
      "the initial check is at `estimatedCompletionAt`",
      "matching `recheckIntervalMs` of 60,000 milliseconds",
      "do not diagnose failure, call `plan` again, requeue or resubmit work",
      "change the provider, model, or settings",
      "present missing tasks as an error",
      "list and cancel every obsolete pending planning-status wakeup created by you",
      "Never use a recurring schedule for planning status",
      "`action: \"followup\"` to save an unplanned idle draft",
      "`manage_scheduler` using `after_sprint_end`",
      "Never call `plan` for that follow-up before its scheduled start",
    ]) {
      expect(instructions).toContain(requiredPlanningGuidance);
    }
  });

  it("installs missing base agents and container setup into the user directory without overwriting existing files", async () => {
    vi.stubEnv("CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS", "1");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-default-assets-"));
    tempDirs.push(dir);
    const projectRoot = path.join(dir, "app");
    const homeDir = path.join(dir, "home");
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("USERPROFILE", homeDir);

    await fs.mkdir(path.join(projectRoot, ".code-ux", "agents"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, ".code-ux", "container"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, ".code-ux", "quicksprints", "templates"), { recursive: true });

    for (const fileName of ["planning_agent.md", "project_manager.md", "quality_assurance_agent.md", "worker.md"]) {
      await fs.writeFile(
        path.join(projectRoot, ".code-ux", "agents", fileName),
        `default ${fileName}\n`,
        "utf8",
      );
    }
    await fs.writeFile(path.join(projectRoot, ".code-ux", "container", "setup.sh"), "#!/usr/bin/env bash\necho setup\n", "utf8");
    await fs.writeFile(
      path.join(projectRoot, ".code-ux", "quicksprints", "templates", "qs-default.md"),
      `---json\n${JSON.stringify({
        id: "qs-default",
        name: "Default Quicksprint",
        description: "Default quicksprint template",
        icon: "Sparkles",
        category: "engineering",
      }, null, 2)}\n---\nPlan default work.\n`,
      "utf8",
    );

    await fs.mkdir(path.join(homeDir, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".code-ux", "agents", "worker.md"), "custom worker\n", "utf8");

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const [result] = await Promise.all(Array.from({ length: 12 }, async () =>
      await ensureDefaultCodeUxAssetsInstalled({ projectRoot, logger })
    ));

    expect(result.sourceDir).toBe(path.join(projectRoot, ".code-ux"));
    expect(result.installed.map((asset) =>
      path.relative(path.join(homeDir, ".code-ux"), asset.targetPath).replace(/\\/g, "/")
    ).sort()).toEqual([
      "agents/planning_agent.md",
      "agents/project_manager.md",
      "agents/quality_assurance_agent.md",
      "container/setup.sh",
      "quicksprints/templates/qs-default.md",
    ]);
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "agents", "worker.md"), "utf8")).resolves.toBe("custom worker\n");
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "agents", "planning_agent.md"), "utf8")).resolves.toBe("default planning_agent.md\n");
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "container", "setup.sh"), "utf8")).resolves.toContain("echo setup");
    await expect(fs.readFile(path.join(homeDir, ".code-ux", "quicksprints", "templates", "qs-default.md"), "utf8")).resolves.toContain("Default Quicksprint");
    expect(logger.info).toHaveBeenCalledTimes(1);

    const repeated = await ensureDefaultCodeUxAssetsInstalled({
      projectRoot,
      logger,
      skipDefaultAgentFiles: true,
    });
    expect(repeated.installed).toEqual([]);
    expect(logger.info).toHaveBeenCalledTimes(1);

    const restoredAgentPath = path.join(homeDir, ".code-ux", "agents", "planning_agent.md");
    await fs.rm(restoredAgentPath);
    const restored = await Promise.all(Array.from({ length: 12 }, async () =>
      await ensureDefaultCodeUxAssetsInstalled({ projectRoot, logger })
    ));
    expect(restored.filter((entry) => entry.installed.length > 0)).toHaveLength(12);
    await expect(fs.readFile(restoredAgentPath, "utf8")).resolves.toBe("default planning_agent.md\n");
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it("migrates the known legacy bootstrap once while preserving user-authored setup scripts", async () => {
    vi.stubEnv("CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS", "1");

    for (const fixture of [
      {
        name: "legacy",
        existingSetup: [
          "#!/usr/bin/env bash",
          'echo "[setup] Starting container bootstrap..."',
          'echo "[setup] Installing @openai/codex..."',
          'if [ "${CODE_UX_INSTALL_PLAYWRIGHT:-0}" = "1" ]; then echo playwright; fi',
        ].join("\n"),
        expectedSetup: "#!/usr/bin/env bash\necho managed baseline\n",
        expectedInstalled: true,
      },
      {
        name: "custom",
        existingSetup: "#!/usr/bin/env bash\necho custom project bootstrap\n",
        expectedSetup: "#!/usr/bin/env bash\necho custom project bootstrap\n",
        expectedInstalled: false,
      },
    ]) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `code-ux-default-assets-${fixture.name}-`));
      tempDirs.push(dir);
      const projectRoot = path.join(dir, "app");
      const homeDir = path.join(dir, "home");
      vi.stubEnv("HOME", homeDir);
      vi.stubEnv("USERPROFILE", homeDir);

      await fs.mkdir(path.join(projectRoot, ".code-ux", "agents"), { recursive: true });
      await fs.mkdir(path.join(projectRoot, ".code-ux", "container"), { recursive: true });
      await fs.mkdir(path.join(projectRoot, ".code-ux", "quicksprints", "templates"), { recursive: true });
      await Promise.all(["planning_agent.md", "project_manager.md", "quality_assurance_agent.md", "worker.md"].map(
        async (fileName) => await fs.writeFile(
          path.join(projectRoot, ".code-ux", "agents", fileName),
          `default ${fileName}\n`,
          "utf8",
        ),
      ));
      await fs.writeFile(
        path.join(projectRoot, ".code-ux", "container", "setup.sh"),
        "#!/usr/bin/env bash\necho managed baseline\n",
        "utf8",
      );
      await fs.mkdir(path.join(homeDir, ".code-ux", "container"), { recursive: true });
      const targetSetupPath = path.join(homeDir, ".code-ux", "container", "setup.sh");
      await fs.writeFile(targetSetupPath, fixture.existingSetup, "utf8");

      const first = await ensureDefaultCodeUxAssetsInstalled({ projectRoot });
      expect(first.installed.some((asset) => asset.targetPath === targetSetupPath)).toBe(fixture.expectedInstalled);
      await expect(fs.readFile(targetSetupPath, "utf8")).resolves.toBe(fixture.expectedSetup);

      const second = await ensureDefaultCodeUxAssetsInstalled({
        projectRoot,
        skipDefaultAgentFiles: true,
      });
      expect(second.installed).toEqual([]);
      await expect(fs.readFile(targetSetupPath, "utf8")).resolves.toBe(fixture.expectedSetup);
    }
  });
});
