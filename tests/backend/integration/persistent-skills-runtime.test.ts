import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SkillRepository } from "../../../src/repositories/skill-repository.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { SkillService, type SkillEmbeddingProvider } from "../../../src/services/skill-service.js";
import type { IProviderRunner, ProviderRunResult } from "../../../src/infrastructure/providers/cli/provider-runner.js";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

class FakeEmbeddingProvider implements SkillEmbeddingProvider {
  isLoaded(): boolean {
    return true;
  }

  getLoadedModelId(): string | null {
    return "fake-2d";
  }

  async embed(text: string): Promise<Float32Array> {
    const lower = text.toLowerCase();
    if (lower.includes("review")) {
      return new Float32Array([1, 0]);
    }
    if (lower.includes("deploy")) {
      return new Float32Array([0, 1]);
    }
    return new Float32Array([0.5, 0.5]);
  }
}

async function createFixture(): Promise<{
  projectId: string;
  projectRepository: ProjectManagementRepository;
  agentPresetRepository: AgentPresetRepository;
  skillService: SkillService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-persistent-skills-runtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const skillRepository = new SkillRepository(storage);
  const skillService = new SkillService(skillRepository, new FakeEmbeddingProvider());
  const project = projectRepository.createProject({
    name: "Persistent Skills Integration Project",
    sourceType: "local",
    sourceRef: "/workspace/persistent-skills-integration",
  });

  return {
    projectId: project.id,
    projectRepository,
    agentPresetRepository,
    skillService,
  };
}

const parseMcpEnvelope = (response: { content: Array<{ text: string }> }): { result: { results: Array<{ skill: { id: string; name: string } }> } } => {
  return JSON.parse(response.content[0]!.text) as { result: { results: Array<{ skill: { id: string; name: string } }> } };
};

const parseMcpError = (response: { content: Array<{ text: string }> }): { result: { status: string; message: string } } => {
  return JSON.parse(response.content[0]!.text) as { result: { status: string; message: string } };
};

describe("persistent skills runtime integration", () => {
  it("authorizes MCP skill search from the authenticated agent's project attachments", async () => {
    const { projectId, projectRepository, agentPresetRepository, skillService } = await createFixture();
    const firstStorage = skillService.createStorage(projectId, {
      id: "first-review-skills",
      name: "First Review Skills",
    });
    const secondStorage = skillService.createStorage(projectId, {
      id: "second-review-skills",
      name: "Second Review Skills",
    });
    const firstSkill = await skillService.writeSkillFromMarkdown(projectId, firstStorage.id, `---
title: First Review Discipline
---

Review regressions for the first agent.
`);
    const secondSkill = await skillService.writeSkillFromMarkdown(projectId, secondStorage.id, `---
title: Second Review Discipline
---

Review regressions for the second agent.
`);
    const firstAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "review-agent-a",
      name: "Review Agent A",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [firstStorage.id],
    });
    const secondAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "review-agent-b",
      name: "Review Agent B",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [secondStorage.id],
    });
    const otherProject = projectRepository.createProject({
      name: "Other Search Project",
      sourceType: "local",
      sourceRef: "/workspace/other-search-project",
    });
    const handler = new ManagementToolHandler({ skillService } as ConstructorParameters<typeof ManagementToolHandler>[0]);

    const attachedSearch = parseMcpEnvelope(await runWithMcpAgentContext(firstAgent.id, () =>
      handler.handleSearchSkills({
        projectId,
        agentPresetId: firstAgent.id,
        storageId: firstStorage.id,
        query: "review regressions",
        minSimilarity: 0,
      })));
    const omittedScopeSearch = parseMcpEnvelope(await runWithMcpAgentContext(firstAgent.id, () =>
      handler.handleSearchSkills({ projectId, query: "review regressions", minSimilarity: 0 })));
    const mismatchedAgentSearch = parseMcpError(await runWithMcpAgentContext(firstAgent.id, () =>
      handler.handleSearchSkills({ projectId, agentPresetId: secondAgent.id, query: "review regressions" })));
    const unrelatedStorageSearch = parseMcpError(await runWithMcpAgentContext(firstAgent.id, () =>
      handler.handleSearchSkills({ projectId, storageId: secondStorage.id, query: "review regressions" })));
    const projectMismatchSearch = parseMcpError(await runWithMcpAgentContext(firstAgent.id, () =>
      handler.handleSearchSkills({ projectId: otherProject.id, query: "review regressions" })));
    const managerSearch = parseMcpEnvelope(await runWithMcpAgentContext(null, () =>
      handler.handleSearchSkills({ projectId, query: "review regressions", minSimilarity: 0 })));

    expect(attachedSearch.result.results.map((result) => result.skill.id)).toEqual([firstSkill.id]);
    expect(omittedScopeSearch.result.results.map((result) => result.skill.id)).toEqual([firstSkill.id]);
    expect(mismatchedAgentSearch.result).toMatchObject({
      status: "error",
      message: "agentPresetId must match the authenticated MCP agent",
    });
    expect(unrelatedStorageSearch.result).toMatchObject({
      status: "error",
      message: `Skill storage is not attached to the authenticated MCP agent: ${secondStorage.id}`,
    });
    expect(projectMismatchSearch.result).toMatchObject({ status: "error" });
    expect(projectMismatchSearch.result.message).toContain(firstAgent.id);
    expect(managerSearch.result.results.map((result) => result.skill.id).sort()).toEqual([firstSkill.id, secondSkill.id].sort());
  });

  it("injects persistent skill prompt guidance and isolated mounts only for enabled attached agents", async () => {
    const { projectId, projectRepository, agentPresetRepository, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, {
      id: "runtime-review-skills",
      name: "Runtime Review Skills",
    });
    const enabledAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "runtime-enabled-agent",
      name: "Runtime Enabled Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [storage.id],
    });
    const disabledAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "runtime-disabled-agent",
      name: "Runtime Disabled Agent",
      persistentSkillStorage: { enabled: false },
      persistentSkillStorageIds: [storage.id],
    });
    const unattachedAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "runtime-unattached-agent",
      name: "Runtime Unattached Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [],
    });
    const otherProject = projectRepository.createProject({
      name: "Other Persistent Skills Project",
      sourceType: "local",
      sourceRef: "/workspace/other-persistent-skills-integration",
    });
    const foreignStorage = skillService.createStorage(otherProject.id, {
      id: "foreign-runtime-skills",
      name: "Foreign Runtime Skills",
    });
    const foreignAgent = agentPresetRepository.createAgentPreset(otherProject.id, {
      id: "runtime-foreign-agent",
      name: "Foreign Runtime Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [foreignStorage.id],
    });
    const providerResult: ProviderRunResult = {
      ok: true,
      stdout: "done",
      stderr: "",
      exitCode: 0,
      nativeSessionId: "native-runtime-1",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "unknown",
        rawUsageJson: null,
      },
    };
    const providerRunner: import("vitest").Mocked<IProviderRunner> = {
      runProvider: vi.fn().mockResolvedValue(providerResult),
      runProviderForText: vi.fn(),
    } as unknown as import("vitest").Mocked<IProviderRunner>;
    const executionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-runtime-1", status: "running" }),
      getExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-runtime-1", status: "running" }),
      appendExecutionInvocationMessage: vi.fn(),
      createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-runtime-1", status: "running" }),
      getProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-runtime-1", status: "running" }),
      updateProviderInvocationUsage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
    } as unknown as ExecutionRepository;
    const service = new ProviderExecutionService({
      providerRunner,
      executionRepository,
      agentPresetRepository,
      skillService,
      getMcpConnectionInfo: vi.fn().mockReturnValue({ url: "http://127.0.0.1:4444/mcp", authToken: "test-token" }),
      getGithubToken: vi.fn(),
    });
    const baseArgs = {
      projectId,
      provider: "claude-code" as const,
      model: "test-model",
      prompt: "Implement the task.",
      cwd: "/workspace/test-project",
      apiKey: "test-key",
      sessionId: "session-runtime-1",
      workflowSettings: {
        retryOnReadFileNotFound: false,
        maxRateLimitRetries: 0,
      } as DashboardSettings["cliWorkflow"],
      repoPath: "/workspace/test-project",
      purpose: "task_coding" as const,
      type: "task_coding",
      agentMcpAccess: { codeUxEnabled: false, codeUxToolToggles: [], linkedServerIds: [] },
    };

    await service.executeProvider({ ...baseArgs, mcpAgentId: enabledAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: disabledAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: unattachedAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: foreignAgent.id });
    await service.executeProvider({ ...baseArgs, mcpAgentId: null });

    const enabledRun = providerRunner.runProvider.mock.calls[0]![0];
    expect(enabledRun.prompt).toContain("Implement the task.");
    expect(enabledRun.prompt).toContain("## PERSISTENT SKILL STORAGE");
    expect(enabledRun.prompt).toContain("search_skills");
    expect(enabledRun.mcpConnection).toEqual({
      url: "http://127.0.0.1:4444/mcp",
      authToken: "test-token",
      agentId: enabledAgent.id,
    });
    expect(enabledRun.persistentSkillStorageMounts).toEqual([
      expect.objectContaining({
        storageId: storage.id,
        storageName: "Runtime Review Skills",
        containerPath: "/code-ux/persistent-skills/runtime-review-skills",
      }),
    ]);
    expect(enabledRun.persistentSkillStorageMounts?.[0]?.hostPath).toContain(path.join(".code-ux", "persistent-skill-storages"));

    for (const run of providerRunner.runProvider.mock.calls.slice(1).map((call) => call[0])) {
      expect(run.prompt).toBe("Implement the task.");
      expect(run.mcpConnection).toBeNull();
      expect(run.persistentSkillStorageMounts).toBeUndefined();
    }
  });
});
