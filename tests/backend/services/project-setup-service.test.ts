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

const normalizeSeparators = (value: string): string => value.replace(/\\/g, "/");

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
  lastPrompt: string | null = null;

  constructor(private readonly text: string) {}

  async runProvider(input: Parameters<IProviderRunner["runProvider"]>[0]): Promise<ProviderRunResult> {
    this.lastPrompt = input.prompt;
    return {
      ok: true,
      stdout: this.text,
      stderr: "",
      code: 0,
      usageTelemetry: { ...usageTelemetry, transcriptText: this.text },
      nativeSessionId: null,
    };
  }

  async runProviderForText(input: Parameters<IProviderRunner["runProviderForText"]>[0]): Promise<ProviderRunResult & { text: string }> {
    this.lastPrompt = input.prompt;
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
  lastPrompt: string | null = null;
  readonly runStarted: Promise<void>;
  private markStarted!: () => void;

  constructor() {
    this.runStarted = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
  }

  async runProvider(input: Parameters<IProviderRunner["runProvider"]>[0]): Promise<ProviderRunResult> {
    return await this.runProviderForText(input);
  }

  async runProviderForText(input: Parameters<IProviderRunner["runProviderForText"]>[0]): Promise<ProviderRunResult & { text: string }> {
    this.lastPrompt = input.prompt;
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
    await fs.mkdir(path.join(repoDir, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, ".code-ux", "agents", "worker.md"),
      "Repository worker base template. Preserve workspace protocol and verification discipline.\n",
      "utf8",
    );

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

    const providerRunner = new FakeProviderRunner(JSON.stringify(providerPayload));
    const service = new ProjectSetupService({
      projectManagementRepository,
      settingsRepository,
      executionRepository,
      agentPresetSyncService,
      quicksprintService,
      providerRunner,
      projectRoot: process.cwd(),
    });

    const result = await service.setupProject(project.id, {
      options: { agents: true, quicksprints: true, previewScript: true, ci: true },
    });

    const fullSetupPrompt = providerRunner.lastPrompt || "";
    expect(result.summary).toContain("Vite app");
    expect(fullSetupPrompt).toContain("## Base Agent Templates To Adapt");
    expect(fullSetupPrompt).toContain("### Worker");
    expect(fullSetupPrompt).toContain("Repository worker base template");
    expect(fullSetupPrompt).toContain("## Base Quicksprint Templates To Adapt");
    expect(fullSetupPrompt).toContain("Code Quality & Performance Audit");
    expect(fullSetupPrompt).toContain("## Container Setup Script Template");
    expect(fullSetupPrompt).toContain("Force rebuild version");
    expect(result.createdAgentIds.length).toBeGreaterThanOrEqual(1);
    expect(result.createdQuicksprintTemplateIds).toHaveLength(1);
    const writtenFiles = result.writtenFiles.map(normalizeSeparators);
    expect(writtenFiles).toEqual(expect.arrayContaining([
      ".code-ux/browser/start-preview.sh",
      ".github/workflows/code-ux-basic-checks.yml",
    ]));

    await expect(fs.readFile(path.join(repoDir, ".code-ux/browser/start-preview.sh"), "utf8"))
      .resolves.toContain("npm run dev");
    await expect(fs.readFile(path.join(repoDir, ".github/workflows/code-ux-basic-checks.yml"), "utf8"))
      .resolves.toContain("Code UX Basic Checks");

    const presets = await agentPresetSyncService.listAgentPresets(project.id);
    const setupAgent = presets.find((preset) => preset.name === "Project Setup Agent");
    expect(setupAgent).toBeTruthy();
    expect(presets.some((preset) => preset.name === "Frontend Runtime Agent")).toBe(true);

    const effective = settingsRepository.resolveProjectDashboardSettings(project.id).settings;
    expect(effective.agents.routing.planning.agentPresetId).toBeNull();
    expect(effective.agents.routing.taskCoding.mode).toBe("ORCHESTRATOR");
    expect(effective.agents.routing.taskCoding.orchestratorAgentPresetIds.length).toBeGreaterThanOrEqual(1);
    expect(effective.agents.routing.taskCoding.orchestratorAgentPresetIds).not.toContain(setupAgent?.id);
  });

  it("preserves an existing planning agent route when applying generated agents", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-setup-planning-route-"));
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
      name: "Routed Planner App",
      sourceType: "local",
      sourceRef: repoDir,
    });
    const planner = await agentPresetSyncService.createAgentPreset(project.id, {
      name: "Repository Planning Agent",
      description: "Plans work for this repository.",
      labels: ["planning"],
      instructionMarkdown: "Preserve repository-specific planning policy.",
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        routing: {
          planning: { agentPresetId: planner.id },
        },
      },
    });

    const providerPayload = {
      summary: "Generated coding specialists.",
      agents: [
        {
          name: "Backend Runtime Agent",
          description: "Owns backend runtime work.",
          labels: ["worker"],
          instructionMarkdown: "Inspect backend modules before changing runtime behavior.",
        },
      ],
      quicksprints: [],
      previewScript: null,
      ci: [],
    };
    const providerRunner = new FakeProviderRunner(JSON.stringify(providerPayload));
    const service = new ProjectSetupService({
      projectManagementRepository,
      settingsRepository,
      executionRepository,
      agentPresetSyncService,
      providerRunner,
      projectRoot: process.cwd(),
    });

    await service.setupProject(project.id, {
      options: { agents: true, quicksprints: false, previewScript: false, ci: false },
    });

    const presets = await agentPresetSyncService.listAgentPresets(project.id);
    const setupAgent = presets.find((preset) => preset.name === "Project Setup Agent");
    const generatedWorker = presets.find((preset) => preset.name === "Backend Runtime Agent");
    const effective = settingsRepository.resolveProjectDashboardSettings(project.id).settings;

    expect(effective.agents.routing.planning.agentPresetId).toBe(planner.id);
    expect(effective.agents.routing.planning.agentPresetId).not.toBe(setupAgent?.id);
    expect(effective.agents.routing.taskCoding.mode).toBe("ORCHESTRATOR");
    expect(effective.agents.routing.taskCoding.orchestratorAgentPresetIds).toContain(generatedWorker?.id);
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
      projectRoot: process.cwd(),
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
    const noArtifactPrompt = providerRunner.lastPrompt || "";
    expect(noArtifactPrompt).not.toContain("## Base Agent Templates To Adapt");
    expect(noArtifactPrompt).not.toContain("## Base Quicksprint Templates To Adapt");
    expect(noArtifactPrompt).not.toContain("## Container Setup Script Template");
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
