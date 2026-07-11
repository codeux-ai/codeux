import { describe, expect, it, vi } from "vitest";
import type { AgentPresetRecord, BaseAgentUpdateContext } from "../../../src/contracts/agent-preset-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { AgentBaseUpdateService } from "../../../src/services/agent-base-update-service.js";

function createPreset(overrides: Partial<AgentPresetRecord> = {}): AgentPresetRecord {
  return {
    id: "base-planning",
    projectId: "project-1",
    name: "Planning agent",
    description: "Plans work",
    instructionMarkdown: "Previous bundled instructions.",
    labels: ["planning", "custom-label"],
    sourcePath: null,
    sourceScope: null,
    sourceUpdatedAt: null,
    sourceImportedAt: null,
    sourceExists: false,
    syncStatus: "manual",
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
    persistentSkillStorageIds: ["skills-1"],
    persistentSkillStorage: { enabled: true },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function createContext(overrides: Partial<BaseAgentUpdateContext> = {}): BaseAgentUpdateContext {
  const baseAgentPreset = createPreset();
  const selectedAgentPreset = createPreset({
    id: "selected-planning",
    name: "Specialist planner",
    instructionMarkdown: "# Main prompt\nPlan carefully.\n\n## Custom behavior\nKeep the user's custom workflow.",
  });
  return {
    role: "planning_agent",
    bundledInstructionMarkdown: "Current bundle with a new strict JSON schema and changed MCP rules.",
    bundledRevision: "sha256:current",
    baseAgentPreset,
    selectedAgentPreset,
    notice: {
      projectId: "project-1",
      role: "planning_agent",
      baseAgentPresetId: baseAgentPreset.id,
      selectedAgentPresetId: selectedAgentPreset.id,
      selectedAgentName: selectedAgentPreset.name,
      reason: "alternate_route",
      currentRevision: "sha256:previous",
      availableRevision: "sha256:current",
    },
    ...overrides,
  };
}

function createHarness(options: {
  context?: BaseAgentUpdateContext | null;
  providerOutput?: string;
  providerError?: Error;
} = {}) {
  const context = options.context === undefined ? createContext() : options.context;
  const settings = structuredClone(DEFAULT_DASHBOARD_SETTINGS);
  settings.git.githubMode = "LOCAL";
  settings.workers.virtualWorkerProvider = "codex";
  settings.workers.model = "gpt-5.4";
  settings.aiProvider.invocationRouting.planning.provider = "codex";
  settings.aiProvider.providers.codex = {
    ...settings.aiProvider.providers.codex,
    enabled: true,
    model: "gpt-5.4",
    apiKey: "test-key",
  };
  const applyBaseAgentInstructionUpdate = vi.fn().mockImplementation(
    async (_projectId: string, _role: string, instructionMarkdown: string) => ({
      ...context!.selectedAgentPreset,
      instructionMarkdown,
      baseInstructionStates: {
        planning_agent: {
          role: "planning_agent",
          baselineContentHash: "sha256:current",
          customized: false,
          lastAppliedRevision: "sha256:current",
        },
      },
    }),
  );
  const executeRequest = vi.fn().mockImplementation(async (args) => {
    if (options.providerError) throw options.providerError;
    const bodyMarkdown = options.providerOutput
      ?? JSON.stringify({
        instructionMarkdown: `${context!.selectedAgentPreset.instructionMarkdown}\n\n## System compatibility\nUse the current strict JSON schema.`,
      });
    return {
      parsed: args.parseFn(bodyMarkdown),
      bodyMarkdown,
      nativeSessionId: "native-1",
      sessionId: "logical-1",
      invocationId: "invocation-1",
      selfReflection: { enabled: false, passed: true, attemptCount: 0, finalDecision: "disabled", scores: [] },
    };
  });
  const agentPresetSyncService = {
    listBaseAgentUpdateNotices: vi.fn().mockResolvedValue(context?.notice ? [context.notice] : []),
    getBaseAgentUpdateContext: vi.fn().mockResolvedValue(context),
    applyBaseAgentInstructionUpdate,
  };
  const service = new AgentBaseUpdateService({
    projectManagementRepository: {
      getProject: vi.fn().mockReturnValue({ id: "project-1", name: "Test project", baseDir: "/workspace/test-project" }),
    } as any,
    settingsRepository: {
      resolveProjectDashboardSettings: vi.fn().mockReturnValue({ settings }),
    } as any,
    agentPresetSyncService: agentPresetSyncService as any,
    structuredAgentRequestService: { executeRequest } as any,
  });
  return { service, context, executeRequest, applyBaseAgentInstructionUpdate };
}

describe("AgentBaseUpdateService", () => {
  it("routes a compatibility-only merge through a structured planning invocation", async () => {
    const { service, context, executeRequest, applyBaseAgentInstructionUpdate } = createHarness();

    const updated = await service.applyUpdate("project-1", "planning_agent");

    expect(executeRequest).toHaveBeenCalledOnce();
    const request = executeRequest.mock.calls[0]![0];
    expect(request).toMatchObject({
      projectId: "project-1",
      purpose: "planning",
      type: "agent_base_update",
      provider: "codex",
      model: "gpt-5.4",
      sessionIdPrefix: "agent-base-update",
      agentMcpAccess: { codeUxEnabled: false, linkedServerIds: [] },
      mcpAgentId: null,
    });
    expect(request.providerPrompt).toContain("## Previous bundled/base instructions\nPrevious bundled instructions.");
    expect(request.providerPrompt).toContain("## Current bundled instructions\nCurrent bundle with a new strict JSON schema");
    expect(request.providerPrompt).toContain(context!.selectedAgentPreset.instructionMarkdown);
    expect(request.providerPrompt).toContain("Preserve the user's main prompt, custom behavior, and every custom section verbatim");
    expect(request.providerPrompt).toContain("Do not inspect, create, edit, or delete workspace files");
    expect(applyBaseAgentInstructionUpdate).toHaveBeenCalledWith(
      "project-1",
      "planning_agent",
      expect.stringContaining("## Custom behavior"),
      "selected-planning",
    );
    expect(updated).toMatchObject({
      labels: ["planning", "custom-label"],
      avatarConfig: { chassis: "classic", accent: "jade" },
      providerConfigId: "codex",
      model: "gpt-5.4",
      mcpAccess: { linkedServerIds: ["server-1"] },
      persistentSkillStorageIds: ["skills-1"],
    });
  });

  it("does not invoke a provider when no base update is available", async () => {
    const { service, executeRequest, applyBaseAgentInstructionUpdate } = createHarness({ context: null });

    await expect(service.applyUpdate("project-1", "planning_agent")).rejects.toThrow("No base-agent update is available");
    expect(executeRequest).not.toHaveBeenCalled();
    expect(applyBaseAgentInstructionUpdate).not.toHaveBeenCalled();
  });

  it("leaves the preset and baseline untouched when provider output is malformed", async () => {
    const { service, applyBaseAgentInstructionUpdate } = createHarness({
      providerOutput: '{"instructionMarkdown":"valid","avatarConfig":{"accent":"red"}}',
    });

    await expect(service.applyUpdate("project-1", "planning_agent")).rejects.toThrow("must contain only");
    expect(applyBaseAgentInstructionUpdate).not.toHaveBeenCalled();
  });

  it("leaves the preset and baseline untouched when provider execution fails", async () => {
    const { service, applyBaseAgentInstructionUpdate } = createHarness({ providerError: new Error("provider unavailable") });

    await expect(service.applyUpdate("project-1", "planning_agent")).rejects.toThrow("provider unavailable");
    expect(applyBaseAgentInstructionUpdate).not.toHaveBeenCalled();
  });

  it("rejects output that rewrites or removes the selected custom behavior", async () => {
    const { service, applyBaseAgentInstructionUpdate } = createHarness({
      providerOutput: JSON.stringify({ instructionMarkdown: "# Main prompt\nPlan differently." }),
    });

    await expect(service.applyUpdate("project-1", "planning_agent")).rejects.toThrow("rewrote or removed");
    expect(applyBaseAgentInstructionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a selected target owned by another project before provider execution", async () => {
    const context = createContext({
      selectedAgentPreset: createPreset({ id: "foreign-agent", projectId: "project-2" }),
    });
    const { service, executeRequest, applyBaseAgentInstructionUpdate } = createHarness({ context });

    await expect(service.applyUpdate("project-1", "planning_agent")).rejects.toThrow("does not belong to this project");
    expect(executeRequest).not.toHaveBeenCalled();
    expect(applyBaseAgentInstructionUpdate).not.toHaveBeenCalled();
  });

  it("rejects arbitrary roles", async () => {
    const { service, executeRequest } = createHarness();

    await expect(service.applyUpdate("project-1", "worker" as any)).rejects.toThrow("Invalid baseAgentRole");
    expect(executeRequest).not.toHaveBeenCalled();
  });
});
