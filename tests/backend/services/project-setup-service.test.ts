import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";
import { QuicksprintService } from "../../../src/services/quicksprint-service.js";
import { ProjectSetupService } from "../../../src/services/project-setup-service.js";
import type { IProviderRunner, ProviderRunResult } from "../../../src/infrastructure/providers/cli/provider-runner.js";

const tempDirs: string[] = [];

const usageTelemetry = {
  transcriptText: "",
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  usageSource: "unavailable" as const,
  rawUsageJson: null,
};

class FakeProviderRunner implements IProviderRunner {
  constructor(private readonly text: string) {}

  async runProvider(): Promise<ProviderRunResult> {
    return {
      ok: true,
      stdout: this.text,
      stderr: "",
      code: 0,
      usageTelemetry: { ...usageTelemetry, transcriptText: this.text },
      nativeSessionId: null,
    };
  }

  async runProviderForText(): Promise<ProviderRunResult & { text: string }> {
    return {
      ok: true,
      stdout: this.text,
      stderr: "",
      code: 0,
      usageTelemetry: { ...usageTelemetry, transcriptText: this.text },
      nativeSessionId: null,
      text: this.text,
    };
  }
}

class DeferredProviderRunner implements IProviderRunner {
  resolveRun!: (text: string) => void;
  readonly runStarted: Promise<void>;
  private markStarted!: () => void;

  constructor() {
    this.runStarted = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
  }

  async runProvider(): Promise<ProviderRunResult> {
    return await this.runProviderForText();
  }

  async runProviderForText(): Promise<ProviderRunResult & { text: string }> {
    this.markStarted();
    const text = await new Promise<string>((resolve) => {
      this.resolveRun = resolve;
    });
    return {
      ok: true,
      stdout: text,
      stderr: "",
      code: 0,
      usageTelemetry: { ...usageTelemetry, transcriptText: text },
      nativeSessionId: null,
      text,
    };
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectSetupService", () => {
  it("applies setup agent artifacts to agents, quicksprints, preview script, CI, and routing", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-setup-"));
    tempDirs.push(repoDir);
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({
      scripts: {
        dev: "vite --host 0.0.0.0",
        lint: "eslint .",
        test: "vitest run",
        build: "vite build",
      },
    }, null, 2));

    const storage = new AppDbStorage();
    const projectManagementRepository = new ProjectManagementRepository(storage);
    const settingsRepository = new SettingsRepository();
    const agentPresetRepository = new AgentPresetRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const agentPresetSyncService = new AgentPresetSyncService({
      projectManagementRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: repoDir,
    });
    const quicksprintService = new QuicksprintService(
      (projectId) => projectManagementRepository.getProject(projectId)?.baseDir || repoDir,
      (projectId, input) => projectManagementRepository.createSprint(projectId, input),
      async () => ({ ok: true }),
      (agentPresetId) => agentPresetRepository.getAgentPreset(agentPresetId),
    );
    const project = projectManagementRepository.createProject({
      name: "Previewable App",
      sourceType: "local",
      sourceRef: repoDir,
    });

    const providerPayload = {
      summary: "Detected a Vite app with lint, test, and build scripts.",
      agents: [
        {
          name: "Frontend Runtime Agent",
          description: "Owns Vite app runtime, UI architecture, and browser behavior.",
          labels: ["worker"],
          instructionMarkdown: "Use Vite project commands and inspect src before changing UI.",
        },
      ],
      quicksprints: [
        {
          name: "Vite Quality Pass",
          description: "Improve Vite app correctness.",
          agentInstructionMarkdown: "Inspect package.json and src, then plan Vite-specific quality work.",
          defaultTaskCount: 4,
        },
      ],
      previewScript: {
        path: ".code-ux/browser/start-preview.sh",
        content: "#!/usr/bin/env bash\nset -euo pipefail\nnpm run dev -- --host 0.0.0.0 --port \"${PORT:-3000}\"",
      },
      ci: [
        {
          provider: "github",
          path: ".github/workflows/code-ux-basic-checks.yml",
          content: "name: Code UX Basic Checks\non: [push]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps: []",
        },
      ],
    };

    const service = new ProjectSetupService({
      projectManagementRepository,
      settingsRepository,
      executionRepository,
      agentPresetSyncService,
      quicksprintService,
      providerRunner: new FakeProviderRunner(JSON.stringify(providerPayload)),
    });

    const result = await service.setupProject(project.id, {
      options: { agents: true, quicksprints: true, previewScript: true, ci: true },
    });

    expect(result.summary).toContain("Vite app");
    expect(result.createdAgentIds.length).toBeGreaterThanOrEqual(1);
    expect(result.createdQuicksprintTemplateIds).toHaveLength(1);
    expect(result.writtenFiles).toEqual(expect.arrayContaining([
      ".code-ux/browser/start-preview.sh",
      ".github/workflows/code-ux-basic-checks.yml",
    ]));

    await expect(fs.readFile(path.join(repoDir, ".code-ux/browser/start-preview.sh"), "utf8"))
      .resolves.toContain("npm run dev");
    await expect(fs.readFile(path.join(repoDir, ".github/workflows/code-ux-basic-checks.yml"), "utf8"))
      .resolves.toContain("Code UX Basic Checks");

    const presets = await agentPresetSyncService.listAgentPresets(project.id);
    expect(presets.some((preset) => preset.name === "Project Setup Agent")).toBe(true);
    expect(presets.some((preset) => preset.name === "Frontend Runtime Agent")).toBe(true);

    const effective = settingsRepository.resolveProjectDashboardSettings(project.id).settings;
    expect(effective.agents.routing.planning.agentPresetId).toBeTruthy();
    expect(effective.agents.routing.taskCoding.mode).toBe("ORCHESTRATOR");
    expect(effective.agents.routing.taskCoding.orchestratorAgentPresetIds.length).toBeGreaterThanOrEqual(1);
  });

  it("starts background setup and exposes the invocation id before provider completion", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-setup-bg-"));
    tempDirs.push(repoDir);
    await fs.writeFile(path.join(repoDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }, null, 2));

    const storage = new AppDbStorage();
    const projectManagementRepository = new ProjectManagementRepository(storage);
    const settingsRepository = new SettingsRepository();
    const agentPresetRepository = new AgentPresetRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const agentPresetSyncService = new AgentPresetSyncService({
      projectManagementRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: repoDir,
    });
    const project = projectManagementRepository.createProject({
      name: "Background App",
      sourceType: "local",
      sourceRef: repoDir,
    });
    const providerRunner = new DeferredProviderRunner();
    const service = new ProjectSetupService({
      projectManagementRepository,
      settingsRepository,
      executionRepository,
      agentPresetSyncService,
      providerRunner,
    });

    const started = await service.startProjectSetup(project.id, {
      options: { agents: false, quicksprints: false, previewScript: false, ci: false },
    });

    expect(started.accepted).toBe(true);
    expect(started.invocationId).toBeTruthy();
    expect(executionRepository.getExecutionInvocation(started.invocationId)?.status).toBe("running");

    await Promise.race([
      providerRunner.runStarted,
      new Promise((_, reject) => setTimeout(() => {
        const invocation = executionRepository.getExecutionInvocation(started.invocationId);
        reject(new Error(`Provider runner did not start; invocation status=${invocation?.status} error=${invocation?.errorMessage}`));
      }, 1000)),
    ]);
    providerRunner.resolveRun(JSON.stringify({
      summary: "No artifacts requested.",
      agents: [],
      quicksprints: [],
      previewScript: null,
      ci: [],
    }));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(executionRepository.getExecutionInvocation(started.invocationId)?.status).toBe("completed");
  });
});
