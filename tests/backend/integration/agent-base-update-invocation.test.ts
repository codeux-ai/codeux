import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentPresetRecord } from "../../../src/contracts/agent-preset-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { AgentBaseUpdateService } from "../../../src/services/agent-base-update-service.js";
import { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";
import type { ExecutionProviderRunArgs, ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { StructuredAgentRequestService } from "../../../src/services/structured-agent-request-service.js";
import {
  ProviderTransportError,
  StructuredProviderResponseService,
} from "../../../src/services/structured-provider-response-service.js";

const SELECTED_INSTRUCTIONS = "# Main prompt\nPlan carefully.\n\n## Custom behavior\nKeep the user's custom workflow.";
const COMPATIBLE_INSTRUCTIONS = `${SELECTED_INSTRUCTIONS}\n\n## System compatibility\nUse the current strict JSON schema.`;
const MAX_PARSE_RETRIES = 2;

interface Harness {
  projectId: string;
  service: AgentBaseUpdateService;
  agentPresetRepository: AgentPresetRepository;
  executeProvider: ReturnType<typeof vi.fn<(args: ExecutionProviderRunArgs) => Promise<{
    ok: boolean;
    code: number;
    stdout: string;
    stderr: string;
    text: string;
    nativeSessionId: string;
  }>>>;
  selectedBefore: AgentPresetRecord;
  bundledRevision: string;
}

const cleanupCallbacks: Array<() => Promise<void> | void> = [];
const originalAssetInstallSetting = process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;

async function writeBundledAgentAssets(root: string): Promise<void> {
  const agentsDir = path.join(root, ".code-ux", "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(path.join(root, ".code-ux", "container"), { recursive: true });
  await fs.writeFile(path.join(agentsDir, "planning_agent.md"), "Bundled planning instructions.\n", "utf8");
  await fs.writeFile(path.join(agentsDir, "project_manager.md"), "Bundled manager instructions.\n", "utf8");
  await fs.writeFile(path.join(agentsDir, "quality_assurance_agent.md"), "Review changes.\n", "utf8");
  await fs.writeFile(path.join(agentsDir, "worker.md"), "Implement changes.\n", "utf8");
  await fs.writeFile(path.join(root, ".code-ux", "container", "setup.sh"), "#!/bin/sh\n", "utf8");
}

async function createHarness(providerOutput: string | { ok: false; stderr: string }): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-base-invocation-"));
  const repoPath = path.join(root, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  await writeBundledAgentAssets(root);

  const storage = new AppDbStorage(path.join(root, "app.db"));
  const settingsRepository = new SettingsRepository(path.join(root, "settings.db"));
  cleanupCallbacks.push(async () => {
    settingsRepository.close();
    storage.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const projectManagementRepository = new ProjectManagementRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const project = projectManagementRepository.createProject({
    name: "Automatic base update integration fixture",
    sourceType: "local",
    sourceRef: repoPath,
  });

  const initialSettings = settingsRepository.resolveProjectDashboardSettings(project.id).settings;
  settingsRepository.saveProjectSettings(project.id, {
    agents: {
      saveToProjectDirectory: false,
    },
  });

  const agentPresetSyncService = new AgentPresetSyncService({
    projectManagementRepository,
    agentPresetRepository,
    settingsRepository,
    projectRoot: root,
  });
  await agentPresetSyncService.listAgentPresets(project.id);

  const selected = agentPresetRepository.createAgentPreset(project.id, {
    name: "Specialist planner",
    description: "Preserve all non-instruction fields",
    instructionMarkdown: SELECTED_INSTRUCTIONS,
    labels: ["planning", "specialist"],
    avatarConfig: { chassis: "classic", accent: "jade" },
    providerConfigId: "codex",
    model: "gpt-5.4",
    memoryConfig: {
      tier: "both",
      categories: ["decision"],
      minStrength: 1,
      minStrengthPerCategory: {},
      maxShortTerm: 5,
      maxLongTerm: 5,
    },
    mcpAccess: { codeUxEnabled: true, codeUxToolToggles: [], linkedServerIds: ["server-1"] },
  });
  settingsRepository.saveProjectSettings(project.id, {
    agents: {
      saveToProjectDirectory: false,
      routing: {
        planning: { agentPresetId: selected.id },
      },
    },
    aiProvider: {
      provider: "codex",
      strategy: "MANUAL",
      providers: {
        codex: {
          ...initialSettings.aiProvider.providers.codex,
          enabled: true,
          apiKey: "test-key",
          model: "gpt-5.4",
        },
      },
      invocationRouting: {
        planning: {
          ...initialSettings.aiProvider.invocationRouting.planning,
          strategy: "MANUAL",
          provider: "codex",
          allowedProviders: ["codex"],
          providers: {
            codex: {
              enabled: true,
              model: "gpt-5.4",
            },
          },
        },
      },
    },
    cliWorkflow: {
      maxPlanningJsonRetries: MAX_PARSE_RETRIES,
    },
  });

  const context = await agentPresetSyncService.getBaseAgentUpdateContext(project.id, "planning_agent");
  if (!context?.notice) {
    throw new Error("Expected the alternate planning preset to produce a base-agent update notice.");
  }

  const executeProvider = vi.fn(async (_args: ExecutionProviderRunArgs) => {
    if (typeof providerOutput !== "string") {
      return {
        ok: false,
        code: 1,
        stdout: "",
        stderr: providerOutput.stderr,
        text: "",
        nativeSessionId: "native-agent-base-update",
      };
    }
    return {
      ok: true,
      code: 0,
      stdout: providerOutput,
      stderr: "",
      text: providerOutput,
      nativeSessionId: "native-agent-base-update",
    };
  });
  const providerExecutionService = { executeProvider } as unknown as ProviderExecutionService;
  const structuredProviderResponseService = new StructuredProviderResponseService({ providerExecutionService });
  const structuredAgentRequestService = new StructuredAgentRequestService({ structuredProviderResponseService });
  const service = new AgentBaseUpdateService({
    projectManagementRepository,
    settingsRepository,
    agentPresetSyncService,
    structuredAgentRequestService,
  });

  return {
    projectId: project.id,
    service,
    agentPresetRepository,
    executeProvider,
    selectedBefore: structuredClone(selected),
    bundledRevision: context.bundledRevision,
  };
}

beforeEach(() => {
  process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";
});

afterEach(async () => {
  for (const cleanup of cleanupCallbacks.splice(0).reverse()) {
    await cleanup();
  }
  if (originalAssetInstallSetting === undefined) {
    delete process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;
  } else {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = originalAssetInstallSetting;
  }
});

describe("automatic agent base update invocation", () => {
  it.each([
    [
      "fenced JSON",
      `Here is the update:\n\`\`\`json\n${JSON.stringify({ instructionMarkdown: COMPATIBLE_INSTRUCTIONS })}\n\`\`\``,
    ],
    [
      "a supported provider wrapper",
      JSON.stringify({ response: { instructionMarkdown: COMPATIBLE_INSTRUCTIONS } }),
    ],
    [
      "leading and trailing text",
      `Update follows.\n${JSON.stringify({ instructionMarkdown: COMPATIBLE_INSTRUCTIONS })}\nEnd of update.`,
    ],
  ])("applies compatible %s through the real structured response path", async (_label, providerOutput) => {
    const harness = await createHarness(providerOutput);

    const updated = await harness.service.applyUpdate(harness.projectId, "planning_agent");

    expect(harness.executeProvider).toHaveBeenCalledOnce();
    expect(harness.executeProvider).toHaveBeenCalledWith(expect.objectContaining({
      projectId: harness.projectId,
      purpose: "planning",
      type: "agent_base_update",
      provider: "codex",
      model: "gpt-5.4",
      sessionId: expect.stringMatching(/^agent-base-update-codex-/),
      expectTextOutput: true,
    }));
    expect(updated).toMatchObject({
      id: harness.selectedBefore.id,
      instructionMarkdown: COMPATIBLE_INSTRUCTIONS,
      description: harness.selectedBefore.description,
      labels: harness.selectedBefore.labels,
      avatarConfig: harness.selectedBefore.avatarConfig,
      providerConfigId: harness.selectedBefore.providerConfigId,
      model: harness.selectedBefore.model,
      memoryConfig: harness.selectedBefore.memoryConfig,
      mcpAccess: harness.selectedBefore.mcpAccess,
      baseInstructionStates: {
        planning_agent: {
          role: "planning_agent",
          baselineContentHash: harness.bundledRevision,
          customized: false,
          lastAppliedRevision: harness.bundledRevision,
        },
      },
    });
    expect(harness.agentPresetRepository.getAgentPreset(harness.selectedBefore.id)).toEqual(updated);
  });

  it("retries malformed output in the same provider session to the configured cap without mutating the preset", async () => {
    const harness = await createHarness('{"instructionMarkdown":"unterminated}');

    await expect(harness.service.applyUpdate(harness.projectId, "planning_agent")).rejects.toThrow(
      "Base-agent update response was not raw valid JSON.",
    );

    expect(harness.executeProvider).toHaveBeenCalledTimes(MAX_PARSE_RETRIES + 1);
    const calls = harness.executeProvider.mock.calls;
    const sessionId = calls[0]?.[0].sessionId;
    expect(calls.map(([args]) => args.sessionId)).toEqual(Array(MAX_PARSE_RETRIES + 1).fill(sessionId));
    expect(calls[0]?.[0].continueSessionId).toBeUndefined();
    expect(calls.slice(1).map(([args]) => args.continueSessionId)).toEqual(
      Array(MAX_PARSE_RETRIES).fill("native-agent-base-update"),
    );
    expect(calls.slice(1).every(([args]) => args.prompt.includes("Return only a raw JSON object"))).toBe(true);
    expect(harness.agentPresetRepository.getAgentPreset(harness.selectedBefore.id)).toEqual(harness.selectedBefore);
  });

  it("propagates provider execution failures without applying an update", async () => {
    const harness = await createHarness({ ok: false, stderr: "provider boundary failed" });

    await expect(harness.service.applyUpdate(harness.projectId, "planning_agent")).rejects.toBeInstanceOf(
      ProviderTransportError,
    );

    expect(harness.agentPresetRepository.getAgentPreset(harness.selectedBefore.id)).toEqual(harness.selectedBefore);
  });
});
